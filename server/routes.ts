import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import { resizeTask, generateSmartPlan, unblockTask } from "./ai";
import {
  getGoogleCalendarEvents,
  checkGoogleCalendarConnection,
} from "./integrations/googleCalendar";
import {
  getOutlookCalendarEvents,
  checkOutlookConnection,
} from "./integrations/outlook";
import {
  checkGmailConnection,
  getRecentEmailCommitments,
} from "./integrations/gmail";
import { authRouter, authMiddleware } from "./auth";
import { registerDataRoutes } from "./dataRoutes";
import { isIntegrationOwner, claimIntegrationOwnership } from "./integrationOwner";
import { oauthRouter, oauthCallbackRouter } from "./oauthRoutes";
import { getValidGoogleTokens, getValidMicrosoftToken, getUserTokens } from "./userTokenStore";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function buildCoachSystemPrompt(goals: any[], stats: any, history: any[], calendarEvents: any[] = [], lifeContext?: any, gmailItems?: any[], gmailConnected?: boolean): string {
  const completedHistory = history.filter((h: any) => h.completed);
  const skippedHistory = history.filter((h: any) => !h.completed);
  const completionRate = history.length > 0
    ? Math.round((completedHistory.length / history.length) * 100)
    : 0;

  const categorySkipCounts: Record<string, number> = {};
  skippedHistory.forEach((h: any) => {
    categorySkipCounts[h.category] = (categorySkipCounts[h.category] || 0) + 1;
  });
  const strugglingCategories = Object.entries(categorySkipCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  const goalsText = goals.length > 0
    ? goals.map((g: any) => `  - ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit} — ${Math.round((g.current / Math.max(g.target, 1)) * 100)}% complete`).join('\n')
    : '  - No goals set yet';

  const recentCompleted = completedHistory.slice(0, 8).map((h: any) => h.title).join(', ') || 'none';
  const recentSkipped = skippedHistory.slice(0, 8).map((h: any) => h.title).join(', ') || 'none';

  const calendarText = calendarEvents.length > 0
    ? calendarEvents.slice(0, 8).map((e: any) => `  - ${e.time ? e.time + ': ' : ''}${e.title}`).join('\n')
    : '  - No calendar events today';

  const lifeContextSection = lifeContext
    ? `\n## About This Person\n` +
      (lifeContext.priorityGoal ? `- Priority right now: ${lifeContext.priorityGoal}\n` : '') +
      (lifeContext.upcomingDeadline ? `- Upcoming commitment: ${lifeContext.upcomingDeadline}\n` : '') +
      (lifeContext.improvementArea ? `- Wants to improve: ${lifeContext.improvementArea}\n` : '') +
      (lifeContext.currentBlocker ? `- Current blocker: ${lifeContext.currentBlocker}\n` : '') +
      (lifeContext.freeText ? `- Additional context: ${lifeContext.freeText}` : '')
    : '';

  const gmailSection = gmailItems && gmailItems.length > 0
    ? `\n## Recent Emails (last 7 days)\n` +
      gmailItems.slice(0, 40).map((i: any) => {
        const dateStr = i.date ? new Date(i.date).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '';
        const acct = i.accountEmail ? ` [${i.accountEmail}]` : '';
        const labelStr = i.labels?.length ? ` [${i.labels.join(', ')}]` : '';
        return `- [${dateStr}]${acct}${labelStr} From: ${i.from || 'unknown'} | "${i.subject}" — ${i.snippet}`;
      }).join('\n') +
      `\n(Use these to identify commitments, deadlines, or threads the user hasn't logged as tasks yet. Each email is labelled with which Gmail account it came from. When asked about a specific account, filter to those rows. Labels like ⭐ Starred and Important indicate priority. Promotions/Social are lower signal. Refer to these directly — do not ask for more info.)`
    : gmailConnected
      ? `\n## Recent Emails\nGmail is connected but no emails were found in the last 7 days. Do not pretend to have email data you don't have.`
      : `\n## Recent Emails\nGmail is not connected — you have no access to the user's inbox. If asked about emails, tell them to connect Gmail in the Profile tab.`;

  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return `You are GamePlan Coach — a sharp, supportive personal productivity coach embedded in the GamePlan app. You know this user's goals, habits, and patterns intimately. You give specific, actionable advice — not generic motivational fluff.

Today is ${dayOfWeek}, ${dateStr}.

## User Profile
- Current streak: ${stats.streak || 0} days
- Best streak: ${stats.bestStreak || 0} days
- Total tasks completed: ${stats.totalCompleted || 0}
- Total XP earned: ${stats.xp || 0}
- Task completion rate (last 7 days): ${completionRate}% (${completedHistory.length} completed, ${skippedHistory.length} skipped)
${strugglingCategories.length > 0 ? `- Struggling most with: ${strugglingCategories.join(', ')}` : ''}${lifeContextSection}

## Active Goals
${goalsText}

## Today's Calendar
${calendarText}${gmailSection}

## Recent Activity (last 7 days)
- Completed: ${recentCompleted}
- Left undone: ${recentSkipped}

## How you coach

**Response length**: Keep replies short. 2–4 sentences is the default. Use a bullet list only when you have 3+ specific items to name. Never write multi-paragraph essays — the user is on their phone.

**Question-first rule**: When the user's message is open-ended, vague, or could go several directions ("help me", "what should I focus on", "I'm struggling", "any advice?") — ask ONE focused clarifying question before giving advice. Do not give generic advice while waiting for context. One question, nothing else.

**When you have enough context**: Give the direct, specific answer. No caveats, no generic encouragement padding, no restating what they said.

**Exception**: If the user explicitly asks for a plan, full strategy, or deep analysis, you may give a longer structured response — but still prefer lists over paragraphs.

**Other rules**:
- Be direct. Name what you see. Offer a concrete fix.
- For financial/career topics: think like a business advisor. Suggest specific resources (tools, books, frameworks) by name.
- You know what they've been skipping — call it out when relevant.
- Never say "I don't have access to your data" — everything is above.
- Respond in the same language the user writes in.`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.use("/api/auth", authRouter);
  app.use("/api/oauth", oauthCallbackRouter);
  app.use(authMiddleware);
  app.use("/api/oauth", oauthRouter);

  registerDataRoutes(app);

  app.post("/api/ai/resize-task", async (req: Request, res: Response) => {
    try {
      const { taskTitle, taskDescription, detailLevel, direction, history } = req.body;

      if (!taskTitle || detailLevel === undefined || !direction) {
        return res.status(400).json({ error: "taskTitle, detailLevel, and direction are required" });
      }

      if (typeof detailLevel !== 'number' || detailLevel < 1 || detailLevel > 5) {
        return res.status(400).json({ error: "detailLevel must be a number between 1 and 5" });
      }

      if (direction !== 'smaller' && direction !== 'bigger') {
        return res.status(400).json({ error: "direction must be 'smaller' or 'bigger'" });
      }

      const result = await resizeTask({
        taskTitle,
        taskDescription,
        detailLevel: Math.min(5, Math.max(1, detailLevel)),
        direction,
        history: history || [],
      });

      res.json(result);
    } catch (error) {
      console.error("Error resizing task:", error);
      res.status(500).json({ error: "Failed to resize task" });
    }
  });

  app.post("/api/ai/generate-plan", async (req: Request, res: Response) => {
    try {
      const { goals, history, dayOfWeek, lifeContext, gmailItems, energyCheckin, brainDumpTasks, carriedOverTasks, blockedTasks } = req.body;

      const result = await generateSmartPlan({
        goals: goals || [],
        history: history || [],
        dayOfWeek: dayOfWeek || new Date().toLocaleDateString('en-US', { weekday: 'long' }),
        lifeContext: lifeContext || null,
        gmailItems: gmailItems || [],
        energyCheckin: energyCheckin || null,
        existingTasks: brainDumpTasks || [],
        carriedOverTasks: carriedOverTasks || [],
        blockedTasks: blockedTasks || [],
      });

      res.json(result);
    } catch (error) {
      console.error("Error generating plan:", error);
      res.status(500).json({ error: "Failed to generate plan" });
    }
  });

  app.post("/api/ai/unblock-task", async (req: Request, res: Response) => {
    try {
      const { taskTitle, taskDescription, blockerType, skipDays } = req.body;
      if (!taskTitle || !blockerType) {
        return res.status(400).json({ error: "taskTitle and blockerType are required" });
      }
      const result = await unblockTask({ taskTitle, taskDescription, blockerType, skipDays: skipDays || 1 });
      res.json(result);
    } catch (error) {
      console.error("Error unblocking task:", error);
      res.status(500).json({ error: "Failed to generate suggestion" });
    }
  });

  app.post("/api/coach/chat", async (req: Request, res: Response) => {
    try {
      const { messages, goals, stats, history, calendarEvents, lifeContext, gmailItems, gmailConnected } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "messages array is required" });
      }

      const systemPrompt = buildCoachSystemPrompt(goals || [], stats || {}, history || [], calendarEvents || [], lifeContext || null, gmailItems || [], gmailConnected ?? false);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.flushHeaders();

      const stream = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m: any) => ({ role: m.role, content: m.content })),
        ],
        stream: true,
        max_completion_tokens: 8192,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      console.error("Error in coach chat:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to get coach response" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/coach/suggestions", async (req: Request, res: Response) => {
    try {
      const { lastAssistantMessage, goals } = req.body;
      if (!lastAssistantMessage) {
        return res.json({ actions: [], followups: [] });
      }

      const prompt = `Analyze this coaching message and extract structured suggestions.

Coaching message:
"${lastAssistantMessage}"

User's active goals:
${(goals || []).map((g: any) => `- ${g.title} (${g.category})`).join('\n') || 'None set'}

Return a JSON object with:
1. "actions": array of 0-2 specific, immediately actionable tasks or goals mentioned or implied in the message. Each action: { "type": "task" or "goal", "title": string (concise, starts with verb for tasks), "category": one of "fitness/finance/career/personal/social", "priority": "high"/"medium"/"low" (tasks only), "description": short one-line context }. Only include if genuinely specific and actionable — return empty array if message is conversational.
2. "followups": array of exactly 3 short follow-up questions (max 7 words each) the user would naturally ask next.

Return ONLY the JSON object.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 600,
      });

      const content = response.choices[0]?.message?.content || '{"actions":[],"followups":[]}';
      try {
        const parsed = JSON.parse(content);
        res.json({
          actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 2) : [],
          followups: Array.isArray(parsed.followups) ? parsed.followups.slice(0, 3) : [],
        });
      } catch {
        res.json({ actions: [], followups: [] });
      }
    } catch (error) {
      console.error("Error generating suggestions:", error);
      res.json({ actions: [], followups: [] });
    }
  });

  app.post("/api/ai/parse-brain-dump", async (req: Request, res: Response) => {
    try {
      const { text } = req.body;
      if (!text?.trim()) {
        return res.json({ tasks: [] });
      }

      const prompt = `You are a productivity assistant helping organize a brain dump into actionable tasks.

Brain dump text: "${text.trim()}"

Read the text above and identify each distinct action item or topic. Different subjects become different tasks. If one task has multiple steps, list them as subtasks.

For each task provide:
- title: concise action phrase starting with a verb
- description: one sentence of context (or null if title is self-explanatory)
- priority: "high", "medium", or "low"
- category: one of "personal", "career", "finance", "fitness", "social"
- subtasks: array of short action strings (empty array if not needed)

Return ONLY a JSON object with a "tasks" array. No other text.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 8192,
      });

      const content = response.choices[0]?.message?.content || '{"tasks":[]}';
      try {
        const parsed = JSON.parse(content);
        const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
        res.json({ tasks });
      } catch {
        res.json({ tasks: [] });
      }
    } catch (error) {
      console.error("Error parsing brain dump:", error);
      res.json({ tasks: [] });
    }
  });

  app.post("/api/coach/checkin", async (req: Request, res: Response) => {
    try {
      const { goals, stats, history, lifeContext } = req.body;

      const completedHistory = (history || []).filter((h: any) => h.completed);
      const skippedHistory = (history || []).filter((h: any) => !h.completed);
      const completionRate = history?.length > 0
        ? Math.round((completedHistory.length / history.length) * 100)
        : 0;
      const goalsText = (goals || []).length > 0
        ? (goals as any[]).map((g: any) => `${g.title}: ${g.current}/${g.target} ${g.unit}`).join(', ')
        : 'no goals set';

      const lifeCtxText = lifeContext
        ? `\n- Priority: ${lifeContext.priorityGoal || 'not set'}` +
          (lifeContext.currentBlocker ? `\n- Known blocker: ${lifeContext.currentBlocker}` : '') +
          (lifeContext.improvementArea ? `\n- Wants to improve: ${lifeContext.improvementArea}` : '')
        : '';

      const prompt = `You are a personal productivity coach. Write a 1-2 sentence daily coaching note for this person.

Their profile:
- Streak: ${stats?.streak || 0} days, ${completionRate}% task completion this week
- Goals: ${goalsText}
- Recently completed: ${completedHistory.slice(0, 4).map((h: any) => h.title).join(', ') || 'nothing yet'}
- Recently skipped: ${skippedHistory.slice(0, 3).map((h: any) => h.title).join(', ') || 'nothing'}${lifeCtxText}

Write ONE short, specific coaching observation. Be direct — name what's working or what to fix. If they have a clear priority or blocker, reference it specifically. No greeting, no sign-off.

Return JSON: { "note": "your 1-2 sentence note here" }`;

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
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

  app.get("/api/calendar/status", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.json({ google: false, outlook: false });

      const [googleTokens, microsoftToken] = await Promise.all([
        getValidGoogleTokens(userId),
        getValidMicrosoftToken(userId),
      ]);

      let googleConnected = googleTokens.length > 0;
      let outlookConnected = !!microsoftToken;

      if (!googleConnected || !outlookConnected) {
        const isOwner = await isIntegrationOwner(userId);
        if (isOwner) {
          const [projGoogle, projOutlook] = await Promise.all([
            googleConnected ? true : checkGoogleCalendarConnection(),
            outlookConnected ? true : checkOutlookConnection(),
          ]);
          googleConnected = googleConnected || projGoogle;
          outlookConnected = outlookConnected || projOutlook;
          if (projGoogle || projOutlook) await claimIntegrationOwnership(userId);
        }
      }

      res.json({ google: googleConnected, outlook: outlookConnected });
    } catch (error) {
      console.error("Error checking calendar status:", error);
      res.json({ google: false, outlook: false });
    }
  });

  app.get("/api/calendar/google/events", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.json({ connected: false, events: [] });

      const accessTokens = await getValidGoogleTokens(userId);
      let hasIntegration = false;
      if (accessTokens.length === 0) {
        if (!(await isIntegrationOwner(userId))) return res.json({ connected: false, events: [] });
        hasIntegration = true;
      }

      const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const startTime = req.query.startTime as string | undefined;
      const endTime = req.query.endTime as string | undefined;

      const tokensToFetch = accessTokens.length > 0 ? accessTokens : [undefined];
      const allEvents = await Promise.all(
        tokensToFetch.map(token =>
          getGoogleCalendarEvents(date, startTime, endTime, token).catch(() => [])
        )
      );
      const events = allEvents.flat();
      res.json({ connected: true, events });
    } catch (error: any) {
      console.error("Error fetching Google Calendar events:", error);
      if (error.message?.includes('not connected')) return res.json({ connected: false, events: [] });
      res.json({ connected: true, events: [] });
    }
  });

  app.get("/api/calendar/outlook/events", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.json({ connected: false, events: [] });

      let accessToken = await getValidMicrosoftToken(userId);
      if (!accessToken) {
        if (!(await isIntegrationOwner(userId))) return res.json({ connected: false, events: [] });
      }

      const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const startTime = req.query.startTime as string | undefined;
      const endTime = req.query.endTime as string | undefined;
      const events = await getOutlookCalendarEvents(date, startTime, endTime, accessToken);
      res.json({ connected: true, events });
    } catch (error: any) {
      console.error("Error fetching Outlook events:", error);
      if (error.message?.includes('not connected')) return res.json({ connected: false, events: [] });
      res.json({ connected: true, events: [] });
    }
  });

  app.get("/api/gmail/status", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.json({ connected: false });

      const googleTokens = await getValidGoogleTokens(userId);
      if (googleTokens.length > 0) return res.json({ connected: true });

      const isOwner = await isIntegrationOwner(userId);
      if (!isOwner) return res.json({ connected: false });

      const connected = await checkGmailConnection();
      if (connected) await claimIntegrationOwnership(userId);
      res.json({ connected });
    } catch (error) {
      console.error("Error checking Gmail status:", error);
      res.json({ connected: false });
    }
  });

  app.get("/api/gmail/commitments", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.json({ connected: false, items: [] });

      const userTokens = await getUserTokens(userId, 'google');
      if (userTokens.length === 0) {
        if (!(await isIntegrationOwner(userId))) return res.json({ connected: false, items: [] });
        const connected = await checkGmailConnection();
        if (!connected) return res.json({ connected: false, items: [] });
        const items = await getRecentEmailCommitments(7, undefined);
        return res.json({ connected: true, items });
      }

      const perAccountItems = await Promise.all(
        userTokens.map(async (t) => {
          const emails = await getRecentEmailCommitments(7, t.accessToken).catch(() => []);
          return emails.map((e) => ({ ...e, accountEmail: t.accountEmail }));
        })
      );

      // Interleave results so both accounts appear in the list
      const interleaved: any[] = [];
      const maxLen = Math.max(...perAccountItems.map((a) => a.length));
      for (let i = 0; i < maxLen; i++) {
        for (const account of perAccountItems) {
          if (i < account.length) interleaved.push(account[i]);
        }
      }
      res.json({ connected: true, items: interleaved });
    } catch (error) {
      console.error("Error fetching Gmail commitments:", error);
      res.json({ connected: false, items: [] });
    }
  });

  app.post("/api/gmail/scan-for-tasks", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.json({ suggestions: [] });

      const { goals } = req.body;
      if (!goals || !Array.isArray(goals) || goals.length === 0) {
        return res.json({ suggestions: [] });
      }

      const userTokens = await getUserTokens(userId, 'google');
      let allEmails: any[] = [];

      if (userTokens.length === 0) {
        if (!(await isIntegrationOwner(userId))) return res.json({ suggestions: [] });
        const connected = await checkGmailConnection();
        if (!connected) return res.json({ suggestions: [] });
        const items = await getRecentEmailCommitments(7, undefined);
        allEmails = items;
      } else {
        const perAccountItems = await Promise.all(
          userTokens.map(async (t) => {
            const emails = await getRecentEmailCommitments(7, t.accessToken).catch(() => []);
            return emails.map((e) => ({ ...e, accountEmail: t.accountEmail }));
          })
        );
        allEmails = perAccountItems.flat();
      }

      if (allEmails.length === 0) {
        return res.json({ suggestions: [] });
      }

      const goalsText = goals.map((g: any) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join('\n');

      const emailsText = allEmails.slice(0, 30).map((e: any) => {
        const acct = e.accountEmail ? ` [Account: ${e.accountEmail}]` : '';
        const labels = e.labels ? ` [Labels: ${e.labels.join(', ')}]` : '';
        return `- From: ${e.from || 'unknown'}${acct}${labels} | Subject: "${e.subject}" | Snippet: ${e.snippet}`;
      }).join('\n');

      const prompt = `You are a productivity assistant. Given the user's goals and recent emails, identify 3–5 specific tasks they should do. Prioritise emails that are Starred, Important, or from real people (not newsletters/promotions).

Goals:
${goalsText}

Recent emails (last 7 days):
${emailsText}

Return JSON:
{ "suggestions": [
  {
    "title": "action-verb task title (concise)",
    "emailSubject": "email that triggered this",
    "emailFrom": "sender",
    "accountEmail": "which Gmail account",
    "goalTitle": "which goal this serves (or 'General' if no specific goal)",
    "reason": "one sentence why this task matters"
  }
]}
Only return the JSON object, no extra text.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content || '{"suggestions":[]}';
      try {
        const parsed = JSON.parse(content);
        const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5) : [];
        res.json({ suggestions });
      } catch {
        res.json({ suggestions: [] });
      }
    } catch (error) {
      console.error("Error scanning emails for tasks:", error);
      res.json({ suggestions: [] });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
