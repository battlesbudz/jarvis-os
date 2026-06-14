import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "../db";
import { createRoutedOpenAIChatShim } from "../agent/routedChatCompletion";
import { buildGmailSourceId, gmailMessageIdExistsForUser } from "../utils/gmailSourceId";
import { getGoogleCalendarEvents } from "../integrations/googleCalendar";
import { getOutlookCalendarEvents } from "../integrations/outlook";
import { checkGmailConnection, getRecentEmailCommitments, createGmailDraft } from "../integrations/gmail";
import { getSlackMessages } from "../integrations/slack";
import { isIntegrationOwner, claimIntegrationOwnership } from "../integrationOwner";
import { getValidGoogleTokens, getValidMicrosoftToken, getUserTokens, getUserToken } from "../userTokenStore";

const openai = createRoutedOpenAIChatShim("[IntegrationRoutes]", "balanced");

export function registerIntegrationRoutes(app: Express): void {
  app.get("/api/calendar/status", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.json({ google: false, outlook: false });

      const [googleTokens, microsoftToken] = await Promise.all([
        getValidGoogleTokens(userId),
        getValidMicrosoftToken(userId),
      ]);

      const googleConnected = googleTokens.length > 0;
      const outlookConnected = !!microsoftToken;

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

      const emailsText = allEmails.slice(0, 30).map((e: any, idx: number) => {
        const acct = e.accountEmail ? ` [Account: ${e.accountEmail}]` : '';
        const labels = e.labels ? ` [Labels: ${e.labels.join(', ')}]` : '';
        const msgId = e.messageId ? ` [id:${e.messageId}]` : '';
        return `${idx + 1}.${msgId} From: ${e.from || 'unknown'}${acct}${labels} | Subject: "${e.subject}" | Snippet: ${e.snippet}`;
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
    "emailMessageId": "the exact id: value from the email, if present",
    "accountEmail": "which Gmail account",
    "goalTitle": "which goal this serves (or 'General' if no specific goal)",
    "reason": "one sentence why this task matters"
  }
]}
Only return the JSON object, no extra text.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        user: userId,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content || '{"suggestions":[]}';
      try {
        const parsed = JSON.parse(content);
        const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5) : [];

        for (const suggestion of suggestions) {
          const matchedEmail = allEmails.find((e: any) => {
            if (suggestion.emailMessageId && e.messageId) {
              return e.messageId === suggestion.emailMessageId;
            }
            if (suggestion.emailSubject && e.subject === suggestion.emailSubject) return true;
            if (suggestion.emailFrom && e.from && e.from.includes(suggestion.emailFrom)) return true;
            return false;
          });
          if (!matchedEmail) continue;
          const msgId = matchedEmail.messageId || matchedEmail.id || null;
          if (msgId && await gmailMessageIdExistsForUser(userId, msgId)) continue;
          const emailId = buildGmailSourceId(
            matchedEmail.accountEmail || '',
            msgId,
            { subject: matchedEmail.subject || '', from: matchedEmail.from || '', receivedAt: matchedEmail.receivedAt || new Date(matchedEmail.date || 0).getTime() }
          );
          try {
            await db.insert(schema.inboxItems).values({
              userId,
              sourceType: "email",
              sourceId: emailId,
              subject: matchedEmail.subject || suggestion.emailSubject || "(no subject)",
              sender: matchedEmail.from || suggestion.emailFrom || null,
              snippet: matchedEmail.snippet || null,
              jarvisReason: "Jarvis created a task from this email",
              suggestedActions: [
                { label: "Reply", actionType: "reply" },
                { label: "Archive", actionType: "archive" },
                { label: "Dismiss", actionType: "dismiss" },
              ],
            }).onConflictDoNothing();
          } catch (inboxErr) {
            console.error("[GmailScan] inbox_items insert failed:", inboxErr);
          }
        }

        res.json({ suggestions });
      } catch {
        res.json({ suggestions: [] });
      }
    } catch (error) {
      console.error("Error scanning emails for tasks:", error);
      res.json({ suggestions: [] });
    }
  });

  app.post("/api/gmail/create-draft", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });

      const { to, subject, body, accountEmail } = req.body;
      if (!to || !subject || !body) {
        return res.status(400).json({ error: 'to, subject, and body are required' });
      }

      const userTokens = await getUserTokens(userId, 'google');
      if (userTokens.length === 0) {
        return res.status(400).json({ error: 'no_google_account', message: 'Connect your Google account in Profile to enable drafting' });
      }

      let token: typeof userTokens[0] | undefined;
      if (accountEmail) {
        token = userTokens.find(t => t.accountEmail === accountEmail);
      }
      if (!token) {
        // Pick the first compose-capable account alphabetically for deterministic selection
        // In future: let user pick which account to draft from
        const composeTokens = userTokens
          .filter(t => t.scopes?.includes('gmail.compose'))
          .sort((a, b) => (a.accountEmail ?? '').localeCompare(b.accountEmail ?? ''));
        token = composeTokens[0];
      }
      if (!token) {
        token = userTokens[0];
      }

      if (!token.scopes?.includes('gmail.compose')) {
        return res.json({ error: 'reconnect_required', message: 'Reconnect your Google account to enable drafting' });
      }

      let accessToken = token.accessToken;
      if (token.expiresAt && token.expiresAt.getTime() < Date.now() + 60_000) {
        const { refreshGoogleToken } = await import('../userTokenStore');
        const refreshed = await refreshGoogleToken(token);
        if (!refreshed) {
          return res.json({ error: 'reconnect_required', message: 'Your Google token has expired. Please reconnect in Profile.' });
        }
        accessToken = refreshed.accessToken;
      }

      const result = await createGmailDraft(accessToken, to, subject, body);
      res.json(result);
    } catch (error) {
      console.error("Error creating Gmail draft:", error);
      res.status(500).json({ error: 'Failed to create draft' });
    }
  });

  app.get("/api/slack/status", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.json({ slack: false });

      const token = await getUserToken(userId, 'slack');
      res.json({ slack: !!token });
    } catch (error) {
      console.error("Error checking Slack status:", error);
      res.json({ slack: false });
    }
  });

  app.get("/api/slack/messages", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.json({ connected: false, messages: [] });

      const token = await getUserToken(userId, 'slack');
      if (!token) return res.json({ connected: false, messages: [] });

      const messages = await getSlackMessages(token.accessToken);
      res.json({ connected: true, messages });
    } catch (error) {
      console.error("Error fetching Slack messages:", error);
      res.json({ connected: false, messages: [] });
    }
  });

  app.post("/api/notifications/morning-brief", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      const { tasks, calendarEvents, goals, stats, energyLevel } = req.body;

      if (typeof energyLevel !== 'number' || energyLevel < 1 || energyLevel > 5) {
        return res.status(400).json({ error: "energyLevel must be a number between 1 and 5" });
      }

      const taskList = Array.isArray(tasks) ? tasks : [];
      const eventList = Array.isArray(calendarEvents) ? calendarEvents : [];
      const goalList = Array.isArray(goals) ? goals : [];

      const tasksText = taskList.length > 0
        ? taskList.map((t: { priority?: string; title: string; description?: string; id: string }) => `- [${t.priority || 'medium'}] ${t.title}${t.description ? ': ' + t.description : ''} (id: ${t.id})`).join('\n')
        : 'No tasks planned yet';

      const eventsText = eventList.length > 0
        ? eventList.slice(0, 8).map((e: any) => `- ${e.time ? e.time + ': ' : ''}${e.title}`).join('\n')
        : 'No events today';

      const goalsText = goalList.length > 0
        ? goalList.map((g: any) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join('\n')
        : 'No goals set';

      const energyDescriptions: Record<number, string> = {
        1: 'Dead — barely functional',
        2: 'Low — limited capacity',
        3: 'Okay — moderate capacity',
        4: 'Good — solid capacity',
        5: 'On Fire — peak capacity',
      };

      const orderingGuidance = energyLevel >= 4
        ? 'High energy: put the hardest/most important task first. Front-load cognitively demanding work.'
        : energyLevel === 3
        ? 'Medium energy: start with a quick win for momentum, then the most important task, then a medium one.'
        : 'Low energy: put the easiest tasks first. Defer anything cognitively heavy. Protect their time.';

      const prompt = `You are a productivity coach for someone with ADHD. Given their energy level and tasks, generate a morning briefing card and optimal task order using Atomic Habits principles (momentum-building).

Energy level: ${energyLevel}/5 (${energyDescriptions[energyLevel]})

Today's tasks:
${tasksText}

Today's calendar:
${eventsText}

Goals:
${goalsText}

Stats: streak ${stats?.streak || 0} days, ${stats?.totalCompleted || 0} tasks completed total

Ordering strategy: ${orderingGuidance}

Return JSON with:
{
  "headline": "1 punchy sentence based on energy (max 8 words). Examples: 'You're on fire today' or 'Easy does it today'",
  "suggestion": "1 sentence of specific advice referencing their actual tasks",
  "taskOrder": ["task id 1", "task id 2", "task id 3"]
}

taskOrder: Return up to 3 task IDs from the task list above, reordered optimally for this energy level. Only include IDs that appear in the task list. Prioritise momentum-building.

Return ONLY the JSON object.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        user: userId,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 300,
      });

      const content = response.choices[0]?.message?.content || '{}';
      try {
        const parsed = JSON.parse(content);
        res.json({
          title: "Good morning! \uD83C\uDFAF",
          body: "Set your energy level and plan your day.",
          card: {
            headline: parsed.headline || (energyLevel >= 4 ? "You're on fire today" : energyLevel <= 2 ? "Easy does it today" : "Steady day ahead"),
            suggestion: parsed.suggestion || "Start with something small to build momentum.",
            taskOrder: Array.isArray(parsed.taskOrder) ? parsed.taskOrder.slice(0, 3) : [],
          },
        });
      } catch {
        res.json({
          title: "Good morning! \uD83C\uDFAF",
          body: "Set your energy level and plan your day.",
          card: {
            headline: energyLevel >= 4 ? "You're on fire today" : energyLevel <= 2 ? "Easy does it today" : "Steady day ahead",
            suggestion: "Start with something small to build momentum.",
            taskOrder: [],
          },
        });
      }
    } catch (error) {
      console.error("Error generating morning brief:", error);
      res.status(500).json({ error: "Failed to generate morning brief" });
    }
  });

}
