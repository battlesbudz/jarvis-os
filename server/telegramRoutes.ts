import type { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import * as schema from "@shared/schema";
import { sendMessage, isTelegramConfigured, getUpdates, deleteWebhook, downloadTelegramFile } from "./integrations/telegram";
import { getRecentEmailCommitments } from "./integrations/gmail";
import { getGoogleCalendarEvents } from "./integrations/googleCalendar";
import { getValidGoogleTokens } from "./userTokenStore";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function generateLinkCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function handleCoachReply(userId: string, chatId: string, userText: string, imageUrl?: string): Promise<void> {
  try {
    let userGoals: any[] = [];
    let userStats: any = {};
    let userLifeContext: any = null;
    let userCommitments: any[] = [];
    let chatMessages: any[] = [];
    let gmailItems: any[] = [];
    let calendarEvents: any[] = [];
    let gmailConnected = false;

    const [goalsRow, statsRow, lcRow, chatRow, commitmentsRows, googleTokens] = await Promise.allSettled([
      db.select().from(schema.goals).where(eq(schema.goals.userId, userId)).limit(1),
      db.select().from(schema.stats).where(eq(schema.stats.userId, userId)).limit(1),
      db.select().from(schema.lifeContext).where(eq(schema.lifeContext.userId, userId)).limit(1),
      db.select().from(schema.chatHistory).where(eq(schema.chatHistory.userId, userId)).limit(1),
      db.select().from(schema.commitments)
        .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
        .orderBy(desc(schema.commitments.extractedAt)).limit(10),
      getValidGoogleTokens(userId),
    ]);

    if (goalsRow.status === 'fulfilled') userGoals = (goalsRow.value[0]?.data as any[]) || [];
    if (statsRow.status === 'fulfilled') userStats = statsRow.value[0]?.data || {};
    if (lcRow.status === 'fulfilled') userLifeContext = lcRow.value[0]?.data || null;
    if (chatRow.status === 'fulfilled') chatMessages = (chatRow.value[0]?.data as any[]) || [];
    if (commitmentsRows.status === 'fulfilled') userCommitments = commitmentsRows.value;

    if (googleTokens.status === 'fulfilled' && googleTokens.value.length > 0) {
      gmailConnected = true;
      const token = googleTokens.value[0];
      const today = new Date().toISOString().split('T')[0];
      console.log(`[Telegram] Fetching Gmail+Calendar for user ${userId}, token length: ${token?.length}`);

      const [emailResult, calResult] = await Promise.allSettled([
        getRecentEmailCommitments(7, token),
        getGoogleCalendarEvents(today, undefined, undefined, token),
      ]);

      if (emailResult.status === 'fulfilled') {
        gmailItems = emailResult.value;
        console.log(`[Telegram] Gmail: ${gmailItems.length} emails`);
      } else {
        console.error(`[Telegram] Gmail fetch failed:`, emailResult.reason);
      }
      if (calResult.status === 'fulfilled') {
        calendarEvents = calResult.value;
        console.log(`[Telegram] Calendar: ${calendarEvents.length} events`);
      } else {
        console.error(`[Telegram] Calendar fetch failed:`, calResult.reason);
      }
    } else {
      console.log(`[Telegram] No Google tokens for user ${userId} — status: ${googleTokens.status}`);
      if (googleTokens.status === 'rejected') console.error(`[Telegram] Token fetch error:`, googleTokens.reason);
    }

    const recentMessages = chatMessages.slice(0, 10).reverse();

    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const goalsText = userGoals.length > 0
      ? userGoals.map((g: any) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit}`).join('\n')
      : 'No goals set';

    const commitmentsText = userCommitments.length > 0
      ? userCommitments.map((c: any) => `- "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ''}`).join('\n')
      : '';

    const calendarText = calendarEvents.length > 0
      ? calendarEvents.slice(0, 8).map((e: any) => `- ${e.time ? e.time + ': ' : ''}${e.title}`).join('\n')
      : '';

    const gmailSection = gmailItems.length > 0
      ? `## Recent Emails (last 7 days from Gmail)\n` +
        gmailItems.slice(0, 15).map((i: any) => `- From: ${i.from || 'unknown'} | "${i.subject}" — ${i.snippet}`).join('\n') +
        `\n(Refer to these directly when asked. Do not say you cannot access email — you have the data above.)`
      : gmailConnected
        ? `## Recent Emails\nGmail is connected but no emails found in the last 7 days.`
        : `## Recent Emails\nGmail not connected — if asked about emails, let the user know.`;

    const systemPrompt = `You are GamePlan Coach — a sharp, supportive personal productivity coach. You're responding via Telegram, so keep messages SHORT (2-4 sentences max). Use plain text, no markdown headers.

Today is ${dayOfWeek}, ${dateStr}.

## User Profile
- Streak: ${userStats.streak || 0} days
- Total completed: ${userStats.totalCompleted || 0}
- XP: ${userStats.xp || 0}

## Active Goals
${goalsText}
${commitmentsText ? `\n## Open Commitments\n${commitmentsText}` : ''}
${calendarText ? `\n## Today's Calendar\n${calendarText}` : ''}

${gmailSection}
${userLifeContext?.priorityGoal ? `\n## Context\n- Priority: ${userLifeContext.priorityGoal}` : ''}

Be direct, specific, actionable. No fluff. You have full access to the user's email and calendar data above — use it. Respond in the same language the user writes in.`;

    let reply = "Sorry, I couldn't generate a response right now.";
    try {
      const userMessageContent = imageUrl
        ? [
            { type: "text" as const, text: userText || "What do you see in this image? Give me your thoughts and any relevant actions." },
            { type: "image_url" as const, image_url: { url: imageUrl } },
          ]
        : userText;

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...recentMessages.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: "user", content: userMessageContent },
        ],
        max_completion_tokens: 2000,
      });
      console.log(`[Telegram] OpenAI finish_reason: ${response.choices?.[0]?.finish_reason}, content length: ${response.choices?.[0]?.message?.content?.length}`);
      reply = response.choices[0]?.message?.content || reply;
    } catch (aiErr: any) {
      console.error("[Telegram] OpenAI error:", aiErr?.status, aiErr?.message, aiErr?.error);
      throw aiErr;
    }

    const userMsg = { id: Date.now().toString(), role: 'user', content: userText };
    const assistantMsg = { id: (Date.now() + 1).toString(), role: 'assistant', content: reply };
    const updatedChat = [assistantMsg, userMsg, ...chatMessages].slice(0, 100);

    try {
      await db.insert(schema.chatHistory)
        .values({ userId, data: updatedChat })
        .onConflictDoUpdate({
          target: schema.chatHistory.userId,
          set: { data: updatedChat, updatedAt: new Date() },
        });
    } catch {}

    await sendMessage(chatId, reply);
  } catch (error) {
    console.error("Error handling Telegram coach reply:", error);
    await sendMessage(chatId, "Sorry, I encountered an error. Please try again.");
  }
}

async function processUpdate(update: any): Promise<void> {
  try {
    if (update.my_chat_member) {
      const chatMember = update.my_chat_member;
      const chat = chatMember.chat;
      const status = chatMember.new_chat_member?.status;
      if ((chat.type === 'group' || chat.type === 'supergroup') && (status === 'member' || status === 'administrator')) {
        const fromUserId = chatMember.from?.id?.toString();
        if (fromUserId) {
          try {
            const link = await db.select().from(schema.telegramLinks).where(
              sql`${schema.telegramLinks.chatId} = ${fromUserId}`
            ).limit(1);
            if (link[0]) {
              const currentGroups = (link[0].groupChatIds as string[]) || [];
              const chatIdStr = chat.id.toString();
              if (!currentGroups.includes(chatIdStr)) {
                currentGroups.push(chatIdStr);
                await db.update(schema.telegramLinks)
                  .set({ groupChatIds: currentGroups })
                  .where(eq(schema.telegramLinks.userId, link[0].userId));
              }
            }
          } catch (err) {
            console.error("Error handling group join:", err);
          }
        }
      }
      return;
    }

    const message = update.message;
    if (!message) return;
    if (!message.text && !message.photo && !message.document) return;

    const chatId = message.chat.id.toString();
    const chatType = message.chat.type;

    let imageUrl: string | undefined;
    let text = message.text?.trim() || message.caption?.trim() || '';

    if (message.photo) {
      const largest = message.photo[message.photo.length - 1];
      const downloaded = await downloadTelegramFile(largest.file_id).catch(() => null);
      if (downloaded) imageUrl = downloaded;
    } else if (message.document && message.document.mime_type?.startsWith('image/')) {
      const downloaded = await downloadTelegramFile(message.document.file_id).catch(() => null);
      if (downloaded) imageUrl = downloaded;
    }

    if (!text && !imageUrl) return;

    if (chatType === 'group' || chatType === 'supergroup') {
      if (!text) return;
      try {
        const links = await db.select().from(schema.telegramLinks).where(
          sql`${schema.telegramLinks.groupChatIds}::jsonb @> ${JSON.stringify([chatId])}::jsonb`
        );
        for (const link of links) {
          await db.insert(schema.telegramGroupMessages).values({
            userId: link.userId,
            chatId,
            chatTitle: message.chat.title || '',
            fromUser: message.from?.first_name || message.from?.username || 'Unknown',
            text: text.slice(0, 500),
            messageDate: new Date(message.date * 1000),
          });
        }
      } catch (err) {
        console.error("Error storing group message:", err);
      }
      return;
    }

    if (text.startsWith('/start ') || (text.length === 6 && /^[A-Z0-9]+$/.test(text))) {
      const code = text.startsWith('/start ') ? text.slice(7).trim() : text;
      try {
        const codeRows = await db.select().from(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.code, code));
        if (codeRows.length === 0) {
          await sendMessage(chatId, "Invalid or expired link code. Please generate a new one from the app.");
          return;
        }
        const { userId } = codeRows[0];
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        if (codeRows[0].createdAt < fiveMinAgo) {
          await db.delete(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.code, code));
          await sendMessage(chatId, "This link code has expired. Please generate a new one from the app.");
          return;
        }
        await db.insert(schema.telegramLinks)
          .values({ userId, chatId, username: message.from?.username || message.from?.first_name || null })
          .onConflictDoUpdate({
            target: schema.telegramLinks.userId,
            set: { chatId, username: message.from?.username || message.from?.first_name || null, linkedAt: new Date() },
          });
        await db.delete(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.code, code));
        await sendMessage(chatId, "✅ You're connected to GamePlan! Jarvis will send you morning check-ins and you can chat anytime right here.");
        console.log(`[Telegram] Linked user ${userId} to chat ${chatId}`);
      } catch (err) {
        console.error("Error linking Telegram:", err);
        await sendMessage(chatId, "Something went wrong linking your account. Please try again.");
      }
      return;
    }

    if (text === '/start') {
      await sendMessage(chatId, "Welcome to GamePlan Coach! To connect your account, generate a link code from the GamePlan app (Profile → Connected Apps → Telegram), then send it here.");
      return;
    }

    try {
      const link = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.chatId, chatId)).limit(1);
      if (link.length === 0) {
        await sendMessage(chatId, "Your Telegram isn't linked to a GamePlan account yet. Open the app, go to Profile > Connected Apps > Telegram, and send the link code here.");
        return;
      }
      await handleCoachReply(link[0].userId, chatId, text, imageUrl);
    } catch (err) {
      console.error("Error handling Telegram message:", err);
      await sendMessage(chatId, "Sorry, something went wrong. Please try again.");
    }
  } catch (error) {
    console.error("Telegram processUpdate error:", error);
  }
}

let pollingOffset = 0;
let pollingActive = false;

export async function startTelegramPolling(): Promise<void> {
  if (!isTelegramConfigured()) return;
  if (pollingActive) return;
  pollingActive = true;
  await deleteWebhook();
  console.log('[Telegram] Polling started');

  const poll = async () => {
    if (!pollingActive) return;
    try {
      const updates = await getUpdates(pollingOffset);
      for (const update of updates) {
        await processUpdate(update);
        pollingOffset = update.update_id + 1;
      }
    } catch (err) {
      console.error('[Telegram] Polling error:', err);
    }
    setTimeout(poll, 2000);
  };

  poll();
}

export function registerTelegramWebhook(app: Express): void {
  app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
    res.sendStatus(200);
    await processUpdate(req.body);
  });
}

export function registerTelegramRoutes(app: Express): void {
  app.post("/api/telegram/link-code", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      if (!isTelegramConfigured()) {
        return res.status(400).json({ error: "Telegram bot not configured. Add TELEGRAM_BOT_TOKEN to secrets." });
      }

      await db.delete(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.userId, userId));

      const code = generateLinkCode();
      await db.insert(schema.telegramLinkCodes).values({ code, userId });

      res.json({ code });
    } catch (error) {
      console.error("Error generating link code:", error);
      res.status(500).json({ error: "Failed to generate link code" });
    }
  });

  app.get("/api/telegram/status", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const link = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId)).limit(1);
      if (link.length === 0) {
        return res.json({ connected: false, username: null, configured: isTelegramConfigured() });
      }

      res.json({
        connected: true,
        username: link[0].username,
        configured: isTelegramConfigured(),
      });
    } catch (error) {
      console.error("Error getting Telegram status:", error);
      res.status(500).json({ error: "Failed to get status" });
    }
  });

  app.delete("/api/telegram/disconnect", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      await db.delete(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting Telegram:", error);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });

  app.get("/api/telegram/messages", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const link = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId)).limit(1);
      if (link.length === 0) {
        return res.json({ connected: false, messages: [] });
      }

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const messages = await db.select()
        .from(schema.telegramGroupMessages)
        .where(and(
          eq(schema.telegramGroupMessages.userId, userId),
          gte(schema.telegramGroupMessages.messageDate, sevenDaysAgo)
        ))
        .orderBy(desc(schema.telegramGroupMessages.messageDate))
        .limit(50);

      res.json({
        connected: true,
        messages: messages.map(m => ({
          chatTitle: m.chatTitle,
          fromUser: m.fromUser,
          text: m.text,
          timestamp: m.messageDate.toISOString(),
        })),
      });
    } catch (error) {
      console.error("Error getting Telegram messages:", error);
      res.status(500).json({ error: "Failed to get messages" });
    }
  });

  app.post("/api/telegram/notify", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { type, message: msgText } = req.body;
      if (!msgText) return res.status(400).json({ error: "message is required" });

      const link = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId)).limit(1);
      if (link.length === 0) {
        return res.json({ sent: false, reason: "Not linked" });
      }

      await sendMessage(link[0].chatId, msgText);
      res.json({ sent: true });
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });
}

async function getCommitmentsForUser(userId: string): Promise<any[]> {
  try {
    return await db
      .select()
      .from(schema.commitments)
      .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
      .orderBy(desc(schema.commitments.extractedAt))
      .limit(20);
  } catch {
    return [];
  }
}

function formatCommitmentsForMessage(commitments: any[], dateKey: string): string {
  const overdue = commitments.filter((c: any) => c.dueDate && c.dueDate < dateKey);
  const dueToday = commitments.filter((c: any) => c.dueDate === dateKey);
  const upcoming = commitments.filter((c: any) => c.dueDate && c.dueDate > dateKey).slice(0, 3);

  const parts: string[] = [];
  if (overdue.length > 0) {
    parts.push(`\nOverdue commitments (${overdue.length}):\n${overdue.slice(0, 5).map((c: any) => `  - "${c.content}" (was due ${c.dueDate})`).join('\n')}`);
  }
  if (dueToday.length > 0) {
    parts.push(`\nDue today (${dueToday.length}):\n${dueToday.map((c: any) => `  - "${c.content}"`).join('\n')}`);
  }
  if (upcoming.length > 0) {
    parts.push(`\nComing up:\n${upcoming.map((c: any) => `  - "${c.content}" (due ${c.dueDate})`).join('\n')}`);
  }
  return parts.join('');
}

export async function startProactiveScheduler(): Promise<void> {
  if (!isTelegramConfigured()) return;

  const SCHEDULE = [
    { type: 'morning', hour: 8, minute: 0 },
    { type: 'commitment_check', hour: 10, minute: 0 },
    { type: 'evening', hour: 20, minute: 0 },
    { type: 'weekly', dayOfWeek: 0, hour: 19, minute: 0 },
  ];

  const lastSent: Record<string, string> = {};

  setInterval(async () => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentDay = now.getDay();
    const dateKey = now.toISOString().slice(0, 10);

    for (const schedule of SCHEDULE) {
      if (currentHour !== schedule.hour || currentMinute !== schedule.minute) continue;
      if (schedule.type === 'weekly' && currentDay !== schedule.dayOfWeek) continue;

      const sentKey = `${schedule.type}-${dateKey}`;
      if (lastSent[sentKey]) continue;
      lastSent[sentKey] = dateKey;

      try {
        const links = await db.select().from(schema.telegramLinks);
        for (const link of links) {
          try {
            let message = '';

            if (schedule.type === 'morning') {
              let userGoals: any[] = [];
              let todayPlan: any = null;
              try {
                const goalsRow = await db.select().from(schema.goals).where(eq(schema.goals.userId, link.userId)).limit(1);
                userGoals = goalsRow[0]?.data as any[] || [];
              } catch {}
              try {
                const planRow = await db.select().from(schema.plans).where(
                  and(eq(schema.plans.userId, link.userId), eq(schema.plans.date, dateKey))
                ).limit(1);
                todayPlan = planRow[0]?.data as any;
              } catch {}

              const tasks = todayPlan?.tasks || [];
              const taskCount = tasks.filter((t: any) => !t.completed).length;
              const goalsList = userGoals.slice(0, 3).map((g: any) => g.title).join(', ');

              message = `Good morning! You have ${taskCount} task${taskCount !== 1 ? 's' : ''} planned today.`;
              if (goalsList) message += ` Active goals: ${goalsList}.`;

              const commitments = await getCommitmentsForUser(link.userId);
              const dueToday = commitments.filter((c: any) => c.dueDate === dateKey);
              const overdue = commitments.filter((c: any) => c.dueDate && c.dueDate < dateKey);
              if (dueToday.length > 0) {
                message += `\n\nCommitments due today: ${dueToday.map((c: any) => `"${c.content}"`).join(', ')}.`;
              }
              if (overdue.length > 0) {
                message += `\n\nOverdue: ${overdue.slice(0, 3).map((c: any) => `"${c.content}" (${c.dueDate})`).join(', ')}.`;
              }

              message += ` Open the app to review your plan or chat with me here.`;
            }

            if (schedule.type === 'commitment_check') {
              const commitments = await getCommitmentsForUser(link.userId);
              const overdue = commitments.filter((c: any) => c.dueDate && c.dueDate < dateKey);
              const dueToday = commitments.filter((c: any) => c.dueDate === dateKey);

              if (overdue.length > 0 || dueToday.length > 0) {
                message = `Accountability check-in:`;
                message += formatCommitmentsForMessage(commitments, dateKey);
                message += `\n\nReply here to update me on progress or chat about blockers.`;
              }
            }

            if (schedule.type === 'evening') {
              let todayPlan: any = null;
              try {
                const planRow = await db.select().from(schema.plans).where(
                  and(eq(schema.plans.userId, link.userId), eq(schema.plans.date, dateKey))
                ).limit(1);
                todayPlan = planRow[0]?.data as any;
              } catch {}

              const tasks = todayPlan?.tasks || [];
              const completed = tasks.filter((t: any) => t.completed).length;
              const total = tasks.length;

              if (total > 0) {
                message = `Evening check-in: You completed ${completed}/${total} tasks today (${total > 0 ? Math.round(completed / total * 100) : 0}%).`;
                if (completed < total) {
                  const remaining = tasks.filter((t: any) => !t.completed).slice(0, 3).map((t: any) => t.title).join(', ');
                  message += ` Still open: ${remaining}.`;
                } else {
                  message += ` Great job finishing everything!`;
                }
              } else {
                message = `Evening check-in: No tasks were planned today. Want to set up tomorrow's plan?`;
              }

              const commitments = await getCommitmentsForUser(link.userId);
              const commitmentInfo = formatCommitmentsForMessage(commitments, dateKey);
              if (commitmentInfo) {
                message += `\n${commitmentInfo}`;
              }
            }

            if (schedule.type === 'weekly') {
              let userStats: any = {};
              let userHistory: any[] = [];
              try {
                const statsRow = await db.select().from(schema.stats).where(eq(schema.stats.userId, link.userId)).limit(1);
                userStats = statsRow[0]?.data || {};
              } catch {}
              try {
                const historyRow = await db.select().from(schema.completionHistory).where(eq(schema.completionHistory.userId, link.userId)).limit(1);
                userHistory = historyRow[0]?.data as any[] || [];
              } catch {}

              const recentCompleted = userHistory.filter((h: any) => h.completed).length;
              const recentTotal = userHistory.length;
              const rate = recentTotal > 0 ? Math.round(recentCompleted / recentTotal * 100) : 0;

              message = `Weekly review: ${recentCompleted}/${recentTotal} tasks completed (${rate}%). Streak: ${userStats.streak || 0} days.`;

              const commitments = await getCommitmentsForUser(link.userId);
              if (commitments.length > 0) {
                message += `\n\nYou have ${commitments.length} open commitment${commitments.length !== 1 ? 's' : ''}:`;
                commitments.slice(0, 5).forEach((c: any) => {
                  message += `\n  - "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ''}`;
                });
              }

              message += `\n\nOpen the app for your full weekly review.`;
            }

            if (message) {
              await sendMessage(link.chatId, message);
            }
          } catch (err) {
            console.error(`Error sending proactive message to user ${link.userId}:`, err);
          }
        }
      } catch (err) {
        console.error("Error in proactive scheduler:", err);
      }
    }
  }, 60 * 1000);

  console.log("Telegram proactive scheduler started");
}
