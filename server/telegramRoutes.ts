import type { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import * as schema from "@shared/schema";
import { sendMessage, sendMessageWithButtons, sendTelegramDocument, answerCallbackQuery, isTelegramConfigured, getUpdates, downloadTelegramFile, downloadTelegramFileBuffer } from "./integrations/telegram";
import { notifyUser } from "./channels/registry";
import type { NotificationType } from "@shared/schema";
import { startMomentumSession, handleMomentumDone, hasMomentumSessionToday, startMomentumExpiryScheduler } from "./momentumCoach";
import { getRecentEmailCommitments, getEmailsSince, getStarredFollowUpEmails, gmailModifyMessage } from "./integrations/gmail";
import { getGoogleCalendarEvents } from "./integrations/googleCalendar";
import { getValidGoogleTokens } from "./userTokenStore";
import { tavilySearch, formatSearchResults } from "./integrations/search";
import { logInteraction, getRecentInteractions, formatInteractionTimeline } from "./interactionLog";
import { extractAndStore } from "./memory/extractor";
import { getSoulPromptBlock } from "./memory/soul";
import { runAgent } from "./agent/harness";
import { telegramCoachTools } from "./agent/tools";
import { runCoachAgent } from "./channels/coachAgent";
import { completePairing as completeDiscordPairing } from "./discord/manager";
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
    const { reply, attachments } = await runCoachAgent({
      userId,
      userText,
      channelName: "Telegram",
      imageUrl,
    });

    let textReply = reply;
    if (attachments.length > 0 && textReply && textReply.trim()) {
      try { await sendMessage(chatId, textReply); } catch (sendErr) {
        console.error("[Telegram] failed to send text before attachment:", sendErr);
      }
      logInteraction(userId, "telegram", "outbound", textReply).catch(() => {});
      textReply = "";
    }

    for (const att of attachments) {
      if (att.kind === "document") {
        const ok = await sendTelegramDocument(chatId, att.filename, att.content, att.caption, att.mimeType);
        console.log(`[Telegram] Delivered attachment ${att.filename} ok=${ok}`);
      }
    }

    if (textReply && textReply.trim()) {
      await sendMessage(chatId, textReply);
      logInteraction(userId, "telegram", "outbound", textReply).catch(() => {});
    }

    extractProfileFromTelegram(userId, userText).catch(err => {
      console.error("[Profile] Telegram extraction error:", err);
    });
    return;
  } catch (error) {
    console.error("Error handling Telegram coach reply:", error);
    await sendMessage(chatId, "Sorry, I encountered an error. Please try again.");
    return;
  }
}

async function isReplyToProactiveQuestion(userText: string, question: string): Promise<boolean> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{
        role: "user",
        content: `Is the following user message a reply to (or related to) this question? Only answer "yes" or "no".

Question that was asked: "${question}"
User's message: "${userText}"

Answer (yes/no):`,
      }],
      max_completion_tokens: 10,
    });
    const answer = (response.choices[0]?.message?.content || '').trim().toLowerCase();
    return answer.startsWith('yes');
  } catch {
    return false;
  }
}

async function extractProfileFromTelegram(userId: string, userText: string): Promise<void> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const unanswered = await db.select()
      .from(schema.proactiveQuestionsSent)
      .where(
        and(
          eq(schema.proactiveQuestionsSent.userId, userId),
          sql`${schema.proactiveQuestionsSent.answeredAt} IS NULL`,
          sql`${schema.proactiveQuestionsSent.sentAt} > ${twentyFourHoursAgo}`
        )
      )
      .orderBy(desc(schema.proactiveQuestionsSent.sentAt))
      .limit(1);

    let contextHint: string | undefined;
    if (unanswered.length > 0) {
      const mostRecent = unanswered[0];
      const isReply = await isReplyToProactiveQuestion(userText, mostRecent.question);
      if (isReply) {
        await db.update(schema.proactiveQuestionsSent)
          .set({ answeredAt: new Date() })
          .where(eq(schema.proactiveQuestionsSent.id, mostRecent.id));
        contextHint = `User is answering proactive question: "${mostRecent.question}"`;
        console.log(`[Profile] Marked proactive question as answered: ${mostRecent.id}`);
      }
    }

    await extractAndStore({
      userId,
      source: userText,
      sourceType: "telegram",
      contextHint,
    });
  } catch (err) {
    console.error("[Profile/Telegram] Extraction error:", err);
  }
}

async function handleCallbackQuery(callbackQuery: any): Promise<void> {
  const queryId: string = callbackQuery.id;
  const data: string = callbackQuery.data || "";
  const chatId: string | undefined = callbackQuery.message?.chat?.id?.toString();
  if (!chatId) {
    await answerCallbackQuery(queryId);
    return;
  }

  if (data.startsWith("momentum_done:")) {
    const parts = data.split(":");
    const claimedUserId: string = parts[1] ?? "";
    const stepIndex = parseInt(parts[2] ?? "0", 10);

    const links = await db
      .select({ userId: schema.telegramLinks.userId })
      .from(schema.telegramLinks)
      .where(eq(schema.telegramLinks.chatId, chatId))
      .limit(1);

    if (links.length === 0 || links[0].userId !== claimedUserId) {
      await answerCallbackQuery(queryId, "Session not found — please re-link your account.");
      console.warn(`[Momentum] Ownership mismatch: claimed=${claimedUserId}, actual=${links[0]?.userId ?? "none"}, chatId=${chatId}`);
      return;
    }

    await answerCallbackQuery(queryId, "Got it! +XP incoming...");
    await handleMomentumDone(claimedUserId, chatId, stepIndex);
    return;
  }

  await answerCallbackQuery(queryId);
}

async function processUpdate(update: any): Promise<void> {
  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query).catch(err =>
        console.error("[Telegram] callback_query error:", err)
      );
      return;
    }

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
    if (!message.text && !message.photo && !message.document && !message.voice && !message.audio && !message.video_note) return;

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

    let audioFileId = message.voice?.file_id || message.audio?.file_id || message.video_note?.file_id;
    if (!audioFileId && message.document && message.document.mime_type?.startsWith('audio/')) {
      audioFileId = message.document.file_id;
    }
    if (audioFileId && !text) {
      try {
        const file = await downloadTelegramFileBuffer(audioFileId);
        if (!file) {
          await sendMessage(chatId, "Sorry, I couldn't download that voice message. Could you try again or type it out?");
          return;
        }
        const { speechToText, detectAudioFormat } = await import('./replit_integrations/audio/client');
        const format = detectAudioFormat(file.buffer);
        const transcript = await speechToText(file.buffer, format);
        if (!transcript || !transcript.trim()) {
          await sendMessage(chatId, "Sorry, I couldn't make out what you said. Could you try again or type it out?");
          return;
        }
        text = transcript.trim();
        const preview = text.length > 100 ? text.slice(0, 100) + '...' : text;
        await sendMessage(chatId, `(🎤 Voice: "${preview}")`);
      } catch (err) {
        console.error('[Telegram] Voice transcription failed:', err);
        await sendMessage(chatId, "Sorry, I couldn't understand that voice message. Could you try again or type it out?");
        return;
      }
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
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
        if (codeRows[0].createdAt < thirtyMinAgo) {
          await db.delete(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.code, code));
          await sendMessage(chatId, "This link code has expired. Please ask Jarvis to connect Telegram again or use Profile → Connections to get a new one.");
          return;
        }
        // Remove any stale links from other accounts that claimed this chatId
        await db.delete(schema.telegramLinks).where(
          and(eq(schema.telegramLinks.chatId, chatId), sql`${schema.telegramLinks.userId} != ${userId}`)
        );
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

      // ── Discord pairing via Telegram ──────────────────────────────────
      // Reuses the same approval UX: user DMs Discord bot → gets 6-char code →
      // sends "approve XXXXXX" (or "pair discord XXXXXX") here to confirm.
      const approveMatch = text?.match(/^(?:approve|pair\s+discord)\s+([A-Z0-9]{6})$/i);
      if (approveMatch) {
        const pairCode = approveMatch[1].toUpperCase();
        const pairResult = await completeDiscordPairing(link[0].userId, pairCode).catch((e) => ({ ok: false as const, error: String(e) }));
        if (pairResult.ok) {
          await sendMessage(chatId, `✅ Discord account linked${pairResult.discordUsername ? ` as ${pairResult.discordUsername}` : ""}! You can now chat with Jarvis directly from Discord.`);
        } else {
          await sendMessage(chatId, `❌ Discord pairing failed: ${pairResult.error || "Invalid or expired code — please DM your Discord bot to get a fresh code."}`);
        }
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
  console.log('[Telegram] Polling started (dev mode — webhook not modified)');

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

export async function getPlansForDateRange(userId: string, startDate: string, endDate: string): Promise<{ date: string; tasks: any[] }[]> {
  try {
    const rows = await db.select().from(schema.plans)
      .where(and(
        eq(schema.plans.userId, userId),
        gte(schema.plans.date, startDate),
        lte(schema.plans.date, endDate),
      ));
    return rows.map(r => ({
      date: r.date,
      tasks: ((r.data as any)?.tasks as any[]) || [],
    }));
  } catch {
    return [];
  }
}

export function computePatternInsights(plans: { date: string; tasks: any[] }[], commitments?: any[]): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayStats: Record<string, { planned: number; completed: number; days: number }> = {};
  for (const d of dayNames) dayStats[d] = { planned: 0, completed: 0, days: 0 };

  const categoryStats: Record<string, { planned: number; completed: number }> = {};
  let totalPlanned = 0;
  let totalCompleted = 0;
  const dailyCounts: { date: string; planned: number; completed: number }[] = [];
  const streakBreakDays: Record<string, number> = {};
  for (const d of dayNames) streakBreakDays[d] = 0;

  for (const plan of plans) {
    const dayOfWeek = dayNames[new Date(plan.date + 'T12:00:00').getDay()];
    const planned = plan.tasks.length;
    const completed = plan.tasks.filter((t: any) => t.completed).length;

    dayStats[dayOfWeek].planned += planned;
    dayStats[dayOfWeek].completed += completed;
    dayStats[dayOfWeek].days += 1;
    totalPlanned += planned;
    totalCompleted += completed;
    dailyCounts.push({ date: plan.date, planned, completed });

    for (const task of plan.tasks) {
      const cat = (task as any).category || 'uncategorized';
      if (!categoryStats[cat]) categoryStats[cat] = { planned: 0, completed: 0 };
      categoryStats[cat].planned += 1;
      if ((task as any).completed) categoryStats[cat].completed += 1;
    }
  }

  const sortedDays = dailyCounts.sort((a, b) => a.date.localeCompare(b.date));
  const planDates = new Set(sortedDays.map(d => d.date));
  if (sortedDays.length >= 2) {
    const firstDate = new Date(sortedDays[0].date + 'T12:00:00');
    const lastDate = new Date(sortedDays[sortedDays.length - 1].date + 'T12:00:00');
    const allDatesInRange: { date: string; planned: number; completed: number }[] = [];
    for (let d = new Date(firstDate); d <= lastDate; d.setDate(d.getDate() + 1)) {
      const dk = d.toISOString().slice(0, 10);
      const existing = sortedDays.find(s => s.date === dk);
      allDatesInRange.push(existing || { date: dk, planned: 0, completed: 0 });
    }
    let prevActive = false;
    for (const day of allDatesInRange) {
      const rate = day.planned > 0 ? day.completed / day.planned : 0;
      const isActiveDay = (rate >= 0.5 && day.planned > 0);
      if (prevActive && !isActiveDay) {
        const dayOfWeek = dayNames[new Date(day.date + 'T12:00:00').getDay()];
        streakBreakDays[dayOfWeek] += 1;
      }
      prevActive = isActiveDay;
    }
  }

  let stats = `BEHAVIORAL DATA (${plans.length} days analyzed):\n\n`;

  stats += `Overall: ${totalCompleted}/${totalPlanned} tasks completed (${totalPlanned > 0 ? Math.round(totalCompleted / totalPlanned * 100) : 0}%)\n`;
  stats += `Avg tasks planned per day: ${plans.length > 0 ? (totalPlanned / plans.length).toFixed(1) : '0'}\n\n`;

  stats += `Day-of-week completion rates:\n`;
  for (const day of dayNames) {
    const s = dayStats[day];
    if (s.days === 0) continue;
    const rate = s.planned > 0 ? Math.round(s.completed / s.planned * 100) : 0;
    stats += `  ${day}: ${rate}% (${s.completed}/${s.planned} across ${s.days} day${s.days > 1 ? 's' : ''})\n`;
  }

  const catEntries = Object.entries(categoryStats).filter(([_, v]) => v.planned >= 2);
  if (catEntries.length > 0) {
    stats += `\nCategory completion rates:\n`;
    for (const [cat, v] of catEntries) {
      stats += `  ${cat}: ${Math.round(v.completed / v.planned * 100)}% (${v.completed}/${v.planned})\n`;
    }
  }

  const breakEntries = Object.entries(streakBreakDays).filter(([_, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (breakEntries.length > 0) {
    stats += `\nStreak break days (days where momentum dropped):\n`;
    for (const [day, count] of breakEntries) {
      stats += `  ${day}: ${count} break${count > 1 ? 's' : ''}\n`;
    }
  }

  if (commitments && commitments.length > 0) {
    const resolved = commitments.filter((c: any) => c.status === 'done').length;
    const expired = commitments.filter((c: any) => c.status === 'expired').length;
    const pending = commitments.filter((c: any) => c.status === 'pending').length;
    const total = commitments.length;
    stats += `\nCommitment follow-through:\n`;
    stats += `  Resolved: ${resolved}/${total} (${Math.round(resolved / total * 100)}%)\n`;
    if (expired > 0) stats += `  Expired: ${expired}/${total}\n`;
    if (pending > 0) stats += `  Still pending: ${pending}\n`;
  }

  return stats;
}

async function generateProactiveMessage(
  type: string,
  context: {
    tasks?: any[];
    goals?: any[];
    commitments?: any[];
    stats?: any;
    dateKey?: string;
    userId?: string;
  }
): Promise<string | null> {
  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateFull = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const allTasks = context.tasks || [];
  const incompleteTasks = allTasks.filter((t: any) => !t.completed);
  const completedTasks = allTasks.filter((t: any) => t.completed);
  const goalsText = (context.goals || []).slice(0, 3).map((g: any) => `${g.title} (${g.current || 0}/${g.target} ${g.unit})`).join(', ') || 'none set';
  const commitmentList = (context.commitments || []).slice(0, 5).map((c: any) => `"${c.content}"${c.dueDate ? ` due ${c.dueDate}` : ''}`).join(', ') || 'none';

  let prompt = '';

  if (type === 'morning') {
    const dueToday = (context.commitments || []).filter((c: any) => c.dueDate === context.dateKey);
    const overdue = (context.commitments || []).filter((c: any) => c.dueDate && c.dueDate < context.dateKey!);
    const tomorrow = new Date(context.dateKey + 'T12:00:00');
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const dueTomorrow = (context.commitments || []).filter((c: any) => c.dueDate === tomorrowKey);
    prompt = `Today is ${dayName}, ${dateFull}. User has ${incompleteTasks.length} task(s) planned.
Tasks: ${incompleteTasks.map((t: any) => t.title).join(', ') || 'none planned'}
Goals: ${goalsText}
Due today: ${dueToday.map((c: any) => `"${c.content}"`).join(', ') || 'none'}
Overdue: ${overdue.map((c: any) => `"${c.content}"`).join(', ') || 'none'}
Due TOMORROW: ${dueTomorrow.map((c: any) => `"${c.content}"`).join(', ') || 'none'}
Streak: ${context.stats?.streak || 0} days

Write a sharp, energizing morning check-in (3-4 sentences). Be specific to their actual tasks/goals. No generic phrases like "Good morning!" Start with something direct. If there are items due tomorrow, give a heads-up so they can plan ahead.`;
  } else if (type === 'commitment_check') {
    const dueToday = (context.commitments || []).filter((c: any) => c.dueDate === context.dateKey);
    const overdue = (context.commitments || []).filter((c: any) => c.dueDate && c.dueDate < context.dateKey!);
    if (dueToday.length === 0 && overdue.length === 0) return null;
    prompt = `Today is ${dayName}, ${dateFull}.
Due today: ${dueToday.map((c: any) => `"${c.content}"`).join(', ') || 'none'}
Overdue: ${overdue.map((c: any) => `"${c.content}" (${c.dueDate})`).join(', ') || 'none'}

Write a brief mid-day accountability check-in (2-3 sentences). Direct, no lecture. Ask what progress has been made on the specific items.`;
  } else if (type === 'evening') {
    const tomorrow = new Date(context.dateKey + 'T12:00:00');
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const dueTomorrow = (context.commitments || []).filter((c: any) => c.dueDate === tomorrowKey);
    prompt = `Today is ${dayName}, ${dateFull}.
Completed: ${completedTasks.length}/${allTasks.length} tasks
Remaining: ${incompleteTasks.slice(0, 3).map((t: any) => t.title).join(', ') || 'none'}
Open commitments: ${commitmentList}
Due TOMORROW: ${dueTomorrow.map((c: any) => `"${c.content}"`).join(', ') || 'none'}
Streak: ${context.stats?.streak || 0} days

Write a concise evening recap (3-4 sentences). Acknowledge what was done, note what's still open. If there are items due tomorrow, specifically call them out so the user can plan tonight. End with something forward-looking. No platitudes.`;
  } else if (type === 'weekly' || type === 'weekly_planning') {
    const userId = context.userId;
    if (userId) {
      const endDate = context.dateKey || new Date().toISOString().slice(0, 10);
      const anchorDate = new Date(endDate + 'T12:00:00');
      const startOfWeekDate = new Date(anchorDate);
      startOfWeekDate.setDate(startOfWeekDate.getDate() - 6);
      const startDate = startOfWeekDate.toISOString().slice(0, 10);

      const weekPlans = await getPlansForDateRange(userId, startDate, endDate);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      let dayByDay = '';
      let weekCompleted = 0;
      let weekPlanned = 0;
      const categoryBreakdown: Record<string, { done: number; total: number }> = {};
      const droppedCategories: Record<string, number> = {};

      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeekDate);
        d.setDate(d.getDate() + i);
        const dk = d.toISOString().slice(0, 10);
        const dayName = dayNames[d.getDay()];
        const plan = weekPlans.find(p => p.date === dk);
        if (plan && plan.tasks.length > 0) {
          const done = plan.tasks.filter((t: any) => t.completed).length;
          const total = plan.tasks.length;
          weekCompleted += done;
          weekPlanned += total;
          dayByDay += `  ${dayName}: ${done}/${total} completed\n`;

          for (const task of plan.tasks) {
            const cat = (task as any).category || 'general';
            if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { done: 0, total: 0 };
            categoryBreakdown[cat].total += 1;
            if ((task as any).completed) {
              categoryBreakdown[cat].done += 1;
            } else {
              droppedCategories[cat] = (droppedCategories[cat] || 0) + 1;
            }
          }
        } else {
          dayByDay += `  ${dayName}: no plan\n`;
        }
      }

      const weekRate = weekPlanned > 0 ? Math.round(weekCompleted / weekPlanned * 100) : 0;

      const catSummary = Object.entries(categoryBreakdown)
        .map(([cat, v]) => `  ${cat}: ${v.done}/${v.total} (${Math.round(v.done / v.total * 100)}%)`)
        .join('\n');

      const droppedTypeEntries = Object.entries(droppedCategories).sort((a, b) => b[1] - a[1]);
      const droppedSummary = droppedTypeEntries.length > 0
        ? `Top dropped task types: ${droppedTypeEntries.slice(0, 5).map(([cat, count]) => `${cat} (${count})`).join(', ')}`
        : 'No incomplete tasks this week';

      const allWeekCommitments = await db.select().from(schema.commitments)
        .where(eq(schema.commitments.userId, userId)).limit(200);
      const weekDueCommitments = allWeekCommitments.filter((c: any) =>
        c.dueDate && c.dueDate >= startDate && c.dueDate <= endDate
      );
      const weekDueDone = weekDueCommitments.filter((c: any) => c.status === 'done').length;
      const weekDueExpired = weekDueCommitments.filter((c: any) => c.status === 'expired').length;
      const weekDueUnresolved = weekDueCommitments.filter((c: any) => c.status === 'pending').length;
      const weekDueTotal = weekDueCommitments.length;
      const commitmentRate = weekDueTotal > 0 ? Math.round(weekDueDone / weekDueTotal * 100) : 0;

      let goalDeltaText = '';
      try {
        const goalsData = (context.goals || []);
        if (goalsData.length > 0) {
          const statsHistory = (context.stats as any)?.goalHistory as any[] | undefined;

          const goalDeltas = goalsData.map((g: any) => {
            const current = g.current || 0;
            let baseline = current;
            if (statsHistory) {
              const priorEntries = statsHistory
                .filter((h: any) => h.goalId === g.id && h.date && h.date <= startDate)
                .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
              if (priorEntries.length > 0) baseline = priorEntries[0].value || 0;
            }
            if (baseline === current && g.previousValue !== undefined) baseline = g.previousValue;
            const delta = current - baseline;
            const deltaStr = delta > 0 ? `+${delta}` : delta === 0 ? 'no change' : `${delta}`;
            return `  ${g.title}: ${current}/${g.target} ${g.unit} (${deltaStr} this week)`;
          });
          goalDeltaText = goalDeltas.join('\n');
        }
      } catch {}
      if (!goalDeltaText) goalDeltaText = goalsText;

      let patternSection = '';
      try {
        const thirtyDaysAgoDate = new Date(anchorDate);
        thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
        const thirtyDayStart = thirtyDaysAgoDate.toISOString().slice(0, 10);
        const allPlans = await getPlansForDateRange(userId, thirtyDayStart, endDate);
        const allCommitmentsRaw = await db.select().from(schema.commitments)
          .where(eq(schema.commitments.userId, userId)).limit(200);
        const scopedCommitments30d = allCommitmentsRaw.filter((c: any) =>
          (c.dueDate && c.dueDate >= thirtyDayStart && c.dueDate <= endDate) ||
          (c.extractedAt && c.extractedAt >= new Date(thirtyDayStart) && c.extractedAt <= new Date(endDate + 'T23:59:59')) ||
          (c.resolvedAt && c.resolvedAt >= new Date(thirtyDayStart) && c.resolvedAt <= new Date(endDate + 'T23:59:59'))
        );
        if (allPlans.length >= 7) {
          patternSection = computePatternInsights(allPlans, scopedCommitments30d);
        }
      } catch {}

      prompt = `WEEKLY PLANNING SESSION — Sunday Review

Day-by-day this week:
${dayByDay}
Week completion rate: ${weekRate}% (${weekCompleted}/${weekPlanned})
${catSummary ? `Category breakdown:\n${catSummary}` : ''}
${droppedSummary}
Commitments due this week: ${weekDueTotal > 0 ? `${commitmentRate}% follow-through (${weekDueDone} resolved / ${weekDueTotal} due)${weekDueExpired > 0 ? ` | ${weekDueExpired} expired` : ''}${weekDueUnresolved > 0 ? ` | ${weekDueUnresolved} still unresolved` : ''}` : 'none due this week'}

Streak: ${context.stats?.streak || 0} days | XP: ${context.stats?.xp || 0}
Goal progress (this week):
${goalDeltaText}
Open commitments: ${commitmentList}

${patternSection ? `PATTERN DATA (30 days):\n${patternSection}` : ''}

Write a comprehensive weekly planning session. Structure it as:
1. WEEK RECAP — what happened day-by-day, what the overall trend was, honest assessment
2. GOAL CHECK — how goals moved (or didn't)
3. CARRY FORWARD — what dropped tasks or commitments should carry into next week
4. INTENTIONS — 3 specific, actionable intentions for next week based on what you see in the data
${patternSection ? '5. PATTERNS — include the top 2-3 behavioral observations from the 30-day pattern data. Name each pattern (e.g. "Friday drop-off", "Health task avoidance"). Be specific with numbers.' : ''}

Use line breaks between sections for readability. Plain text, no markdown. Be direct and honest. This is allowed to be thorough (8-15 sentences total).`;
    } else {
      prompt = `Weekly review.
Streak: ${context.stats?.streak || 0} days | XP: ${context.stats?.xp || 0}
Goals: ${goalsText}
Open commitments: ${commitmentList}

Write a sharp weekly summary (3-4 sentences). What's the trend? What needs focus next week? Be honest and direct.`;
    }
  }

  if (!prompt) return null;

  const isWeeklyPlanning = type === 'weekly' || type === 'weekly_planning';
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'system',
          content: isWeeklyPlanning
            ? 'You are GamePlan Coach Jarvis — a direct, sharp, ADHD-friendly productivity coach. Messages go via Telegram. This is the weekly planning session — you are allowed to be comprehensive (8-15 sentences). Use line breaks between sections for readability. Plain text only, no markdown, no bullet points, no asterisks.'
            : 'You are GamePlan Coach Jarvis — a direct, sharp, ADHD-friendly productivity coach. Messages go via Telegram. Keep it SHORT (3-4 sentences max). Plain text only, no markdown, no bullet points.',
        },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: isWeeklyPlanning ? 4000 : 2000,
    });
    return resp.choices[0]?.message?.content || null;
  } catch (err) {
    console.error('[Proactive] AI generation failed:', err);
    return null;
  }
}

interface ScheduleEntry {
  type: string;
  hour: number;
  minute: number;
  dayOfWeek?: number;
}

// Note: the 'evening' recap type is intentionally excluded here — the
// Jarvis heartbeat daemon owns the evening wrap-up (default 21:00 local).
// It updates XP/streaks, writes a Drive reflection, and pre-loads a
// tomorrow seed. Adding it here would duplicate the notification.
const PROACTIVE_SCHEDULE: ScheduleEntry[] = [
  { type: 'morning', hour: 8, minute: 0 },
  { type: 'commitment_check', hour: 10, minute: 0 },
  { type: 'followup_check', hour: 12, minute: 0 },
  { type: 'momentum_nudge', hour: 14, minute: 0 },
  { type: 'weekly_planning', dayOfWeek: 0, hour: 19, minute: 0 },
];

async function hasAlreadySent(userId: string, messageType: string, dateKey: string): Promise<boolean> {
  try {
    const rows = await db.select({ id: schema.proactiveScheduleLog.id })
      .from(schema.proactiveScheduleLog)
      .where(
        and(
          eq(schema.proactiveScheduleLog.userId, userId),
          eq(schema.proactiveScheduleLog.messageType, messageType),
          eq(schema.proactiveScheduleLog.sentDate, dateKey)
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function markAsSent(userId: string, messageType: string, dateKey: string): Promise<void> {
  try {
    await db.insert(schema.proactiveScheduleLog).values({ userId, messageType, sentDate: dateKey }).catch(() => {});
  } catch {}
}

// Returns one entry per user with any linked channel (telegram chatId may be
// missing for WhatsApp/Slack/daemon-only users). Used by proactive engines so
// every linked user receives scheduled notifications routed by notifyUser.
async function getProactiveEligibleUsers(): Promise<{ userId: string; chatId?: string }[]> {
  const [tgRows, chRows, prefRows] = await Promise.all([
    db.select({ userId: schema.telegramLinks.userId, chatId: schema.telegramLinks.chatId }).from(schema.telegramLinks),
    db.select({ userId: schema.channelLinks.userId }).from(schema.channelLinks),
    db.select({ userId: schema.channelPreferences.userId }).from(schema.channelPreferences),
  ]);
  const chatIdByUser = new Map<string, string>();
  for (const r of tgRows) chatIdByUser.set(r.userId, r.chatId);
  const userIds = new Set<string>();
  for (const r of tgRows) userIds.add(r.userId);
  for (const r of chRows) userIds.add(r.userId);
  for (const r of prefRows) userIds.add(r.userId);
  return Array.from(userIds).map((userId) => ({ userId, chatId: chatIdByUser.get(userId) }));
}

async function sendScheduledMessage(
  link: { userId: string; chatId?: string },
  schedule: ScheduleEntry,
  dateKey: string,
  timezone: string
): Promise<void> {
  if (schedule.type === 'followup_check') {
    const tokens = await getValidGoogleTokens(link.userId).catch(() => []);
    if (!tokens || tokens.length === 0) return;
    const token = tokens[0];
    const starredEmails = await getStarredFollowUpEmails(token, 3);
    if (starredEmails.length === 0) return;
    const emailList = starredEmails.slice(0, 10).map((e) => {
      const senderName = e.from.replace(/<.*>/, '').trim() || e.from;
      return `${senderName} (${e.ageDays}d) — "${e.subject}"`;
    }).join('\n');
    const msg = `📬 ${starredEmails.length} starred/important email${starredEmails.length === 1 ? '' : 's'} sitting >3 days:\n\n${emailList}\n\nStill relevant? Reply, archive, or unstar anything you've handled.`;
    console.log(`[Proactive] Sending followup_check to user ${link.userId} (${timezone})`);
    await notifyUser(link.userId, "general", msg);
    logInteraction(link.userId, "notification", "outbound", msg, "followup_check").catch(() => {});
    return;
  }

  const [goalsRow, planRow, statsRow] = await Promise.allSettled([
    db.select().from(schema.goals).where(eq(schema.goals.userId, link.userId)).limit(1),
    db.select().from(schema.plans).where(and(eq(schema.plans.userId, link.userId), eq(schema.plans.date, dateKey))).limit(1),
    db.select().from(schema.stats).where(eq(schema.stats.userId, link.userId)).limit(1),
  ]);
  const userGoals: any[] = goalsRow.status === 'fulfilled' ? ((goalsRow.value[0]?.data as any[]) || []) : [];
  const todayPlan: any = planRow.status === 'fulfilled' ? (planRow.value[0]?.data as any) : null;
  const userStats: any = statsRow.status === 'fulfilled' ? (statsRow.value[0]?.data || {}) : {};
  const tasks = todayPlan?.tasks || [];

  if (schedule.type === 'momentum_nudge') {
    // Momentum coaching is Telegram-specific (interactive multi-turn session
    // bound to a chat). Skip silently for users without a Telegram chat.
    if (!link.chatId) return;
    const alreadyHasSession = await hasMomentumSessionToday(link.userId, dateKey);
    if (alreadyHasSession) return;
    console.log(`[Proactive] Sending momentum_nudge to user ${link.userId} (${timezone})`);
    await startMomentumSession(link.userId, link.chatId, {
      tasks,
      goals: userGoals,
      stats: userStats,
      dateKey,
    });
    logInteraction(link.userId, "notification", "outbound", "[Momentum coaching session started]", "momentum_nudge").catch(() => {});
    return;
  }

  const commitments = await getCommitmentsForUser(link.userId);
  const message = await generateProactiveMessage(schedule.type, {
    tasks,
    goals: userGoals,
    commitments,
    stats: userStats,
    dateKey,
    userId: link.userId,
  });

  if (message) {
    console.log(`[Proactive] Sending ${schedule.type} to user ${link.userId} (${timezone})`);
    // Map proactive schedule types onto registered NotificationType values so
    // per-type channel preferences (telegram/whatsapp/slack/daemon) apply.
    const typeMap: Record<string, NotificationType> = {
      morning: "morning_briefing",
      commitment_check: "commitment_check",
      weekly_planning: "weekly_planning",
      followup_check: "general",
      momentum_nudge: "general",
    };
    const notifType = typeMap[schedule.type] || "general";
    await notifyUser(link.userId, notifType, message);
    logInteraction(link.userId, "notification", "outbound", message, schedule.type).catch(() => {});
  }
}

export async function runProactiveStartupCatchup(): Promise<void> {
  try {
    const links = await getProactiveEligibleUsers();
    if (links.length === 0) return;

    const allPrefs = await db.select().from(schema.userPreferences);
    const prefsMap: Record<string, any> = {};
    for (const p of allPrefs) prefsMap[p.userId] = (p.data as any) || {};

    const now = new Date();

    for (const link of links) {
      const timezone = prefsMap[link.userId]?.timezone || 'America/New_York';
      const localDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const localHour = localDate.getHours();
      const localDay = localDate.getDay();
      const yr = localDate.getFullYear();
      const mo = String(localDate.getMonth() + 1).padStart(2, '0');
      const dy = String(localDate.getDate()).padStart(2, '0');
      const dateKey = `${yr}-${mo}-${dy}`;

      for (const schedule of PROACTIVE_SCHEDULE) {
        if (schedule.type === 'weekly_planning' && localDay !== (schedule.dayOfWeek ?? -1)) continue;
        const scheduleMinutesFromMidnight = schedule.hour * 60 + schedule.minute;
        const currentMinutesFromMidnight = localHour * 60 + localDate.getMinutes();
        const minutesSinceScheduled = currentMinutesFromMidnight - scheduleMinutesFromMidnight;

        if (minutesSinceScheduled < 0 || minutesSinceScheduled > 120) continue;

        const alreadySent = await hasAlreadySent(link.userId, schedule.type, dateKey);
        if (alreadySent) continue;

        // Claim the slot BEFORE sending so a concurrent scheduler tick
        // can't also pass the hasAlreadySent check and send a duplicate.
        await markAsSent(link.userId, schedule.type, dateKey);
        console.log(`[Proactive] Catchup: sending missed ${schedule.type} to user ${link.userId}`);
        try {
          await sendScheduledMessage(link, schedule, dateKey, timezone);
        } catch (err) {
          console.error(`[Proactive] Catchup error for ${link.userId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[Proactive] Startup catchup error:', err);
  }
}

export async function startProactiveScheduler(): Promise<void> {
  setInterval(async () => {
    const now = new Date();
    try {
      const links = await getProactiveEligibleUsers();
      if (links.length === 0) return;

      const allPrefs = await db.select().from(schema.userPreferences);
      const prefsMap: Record<string, any> = {};
      for (const p of allPrefs) prefsMap[p.userId] = (p.data as any) || {};

      for (const link of links) {
        const timezone = prefsMap[link.userId]?.timezone || 'America/New_York';
        const localDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        const localHour = localDate.getHours();
        const localMinute = localDate.getMinutes();
        const localDay = localDate.getDay();
        const yr = localDate.getFullYear();
        const mo = String(localDate.getMonth() + 1).padStart(2, '0');
        const dy = String(localDate.getDate()).padStart(2, '0');
        const dateKey = `${yr}-${mo}-${dy}`;

        for (const schedule of PROACTIVE_SCHEDULE) {
          if (localHour !== schedule.hour || localMinute !== schedule.minute) continue;
          if (schedule.type === 'weekly_planning' && localDay !== (schedule.dayOfWeek ?? -1)) continue;

          const alreadySent = await hasAlreadySent(link.userId, schedule.type, dateKey);
          if (alreadySent) continue;

          // Claim the slot before sending to prevent catchup/scheduler races
          await markAsSent(link.userId, schedule.type, dateKey);
          try {
            await sendScheduledMessage(link, schedule, dateKey, timezone);
          } catch (err) {
            console.error(`[Proactive] Error for user ${link.userId}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('[Proactive] Scheduler error:', err);
    }
  }, 60 * 1000);

  console.log('Proactive scheduler started (channel-agnostic)');
}

export async function startMeetingBriefScanner(): Promise<void> {
  if (!isTelegramConfigured()) return;

  const SCAN_INTERVAL_MS = 5 * 60 * 1000;
  const sentBriefs = new Set<string>();

  const runScan = async () => {
    try {
      const links = await db.select().from(schema.telegramLinks);
      if (links.length === 0) return;

      const allPrefs = await db.select().from(schema.userPreferences);
      const prefsMap: Record<string, any> = {};
      for (const p of allPrefs) prefsMap[p.userId] = (p.data as any) || {};

      const now = new Date();

      const utcDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const oldKeys = Array.from(sentBriefs).filter(k => !k.includes(utcDateKey));
      for (const k of oldKeys) sentBriefs.delete(k);

      for (const link of links) {
        try {
          const tokens = await getValidGoogleTokens(link.userId).catch(() => []);
          if (!tokens || tokens.length === 0) continue;
          const token = tokens[0];

          const timezone = prefsMap[link.userId]?.timezone || 'America/New_York';
          const localDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
          const localDateStr = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`;

          const events = await getGoogleCalendarEvents(localDateStr, undefined, undefined, token);
          if (events.length === 0) continue;

          const nowMs = now.getTime();

          for (const event of events) {
            const eventStart = new Date(event.start).getTime();
            const minutesUntil = (eventStart - nowMs) / (60 * 1000);

            if (minutesUntil < 10 || minutesUntil > 20) continue;

            const briefKey = `${link.userId}-${event.id}-${localDateStr}`;
            if (sentBriefs.has(briefKey)) continue;
            sentBriefs.add(briefKey);

            let relevantEmails: string[] = [];
            try {
              const titleWords = event.title
                .split(/[\s,\-—]+/)
                .filter(w => w.length > 3)
                .map(w => w.toLowerCase());

              if (titleWords.length > 0) {
                const recentEmails = await getEmailsSince(Date.now() - 7 * 24 * 60 * 60 * 1000, token);
                relevantEmails = recentEmails
                  .filter(e => {
                    const subjectLower = e.subject.toLowerCase();
                    return titleWords.some(w => subjectLower.includes(w));
                  })
                  .slice(0, 3)
                  .map(e => {
                    const senderName = e.from.replace(/<.*>/, '').trim() || e.from;
                    return `"${e.subject}" from ${senderName}`;
                  });
              }
            } catch {}

            const eventTime = new Date(event.start).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            });

            let briefPrompt = `Upcoming meeting in ~15 minutes:
Event: "${event.title}"
Time: ${eventTime}
${event.location ? `Location: ${event.location}` : ''}
${event.description ? `Description: ${event.description.slice(0, 300)}` : ''}
${relevantEmails.length > 0 ? `\nRelated recent emails:\n${relevantEmails.map(e => `- ${e}`).join('\n')}` : ''}

Write a sharp 2-3 sentence meeting prep brief. Include what the meeting is about, highlight any relevant email context if provided, and end with one clear action item or thing to focus on. Be direct, no fluff.`;

            try {
              const resp = await openai.chat.completions.create({
                model: 'gpt-5-mini',
                messages: [
                  {
                    role: 'system',
                    content: 'You are GamePlan Coach Jarvis — a direct, sharp productivity coach. You send pre-meeting prep briefs via Telegram. Keep it SHORT (2-3 sentences). Plain text only, no markdown, no bullet points.',
                  },
                  { role: 'user', content: briefPrompt },
                ],
                max_completion_tokens: 1500,
              });

              const briefMessage = resp.choices[0]?.message?.content;
              if (briefMessage) {
                const header = `📅 Meeting in ~15 min: ${event.title} (${eventTime})${event.location ? `\n📍 ${event.location}` : ''}`;
                const fullMsg = `${header}\n\n${briefMessage}`;
                console.log(`[MeetingBrief] Sending brief for "${event.title}" to user ${link.userId}`);
                await notifyUser(link.userId, "meeting_brief", fullMsg);
                logInteraction(link.userId, "notification", "outbound", fullMsg, "meeting_brief").catch(() => {});
              }
            } catch (err) {
              console.error(`[MeetingBrief] AI generation failed for "${event.title}":`, err);
            }
          }
        } catch (err) {
          console.error(`[MeetingBrief] Error for user ${link.userId}:`, err);
        }
      }
    } catch (err) {
      console.error('[MeetingBrief] Scanner error:', err);
    }
  };

  setTimeout(runScan, 10 * 1000);
  setInterval(runScan, SCAN_INTERVAL_MS);
  console.log('Meeting brief scanner started (5-min interval)');
}

export async function startEmailAlertScanner(): Promise<void> {
  const SCAN_INTERVAL_MS = 30 * 60 * 1000;

  const runScan = async () => {
    try {
      const links = await getProactiveEligibleUsers();
      if (links.length === 0) return;

      const allPrefs = await db.select().from(schema.userPreferences);
      const prefsMap: Record<string, any> = {};
      for (const p of allPrefs) prefsMap[p.userId] = (p.data as any) || {};

      for (const link of links) {
        const prefs = prefsMap[link.userId] || {};
        if (prefs.emailAlertsEnabled === false) continue;

        const tokens = await getValidGoogleTokens(link.userId).catch(() => []);
        if (!tokens || tokens.length === 0) continue;
        const token = tokens[0];

        const sinceMs = prefs.lastEmailScanAt
          ? Number(prefs.lastEmailScanAt)
          : Date.now() - SCAN_INTERVAL_MS;

        const nowMs = Date.now();

        const newPrefs = { ...prefs, lastEmailScanAt: nowMs };
        await db.insert(schema.userPreferences)
          .values({ userId: link.userId, data: newPrefs })
          .onConflictDoUpdate({
            target: schema.userPreferences.userId,
            set: { data: newPrefs, updatedAt: new Date() },
          });

        const emails = await getEmailsSince(sinceMs, token);
        if (emails.length === 0) continue;

        console.log(`[EmailAlert] ${emails.length} new email(s) for user ${link.userId}, classifying...`);

        const { getUserInboxRules, matchItemAgainstRules } = await import("./inboxRules");
        const userRules = await getUserInboxRules(link.userId);

        const filteredEmails: typeof emails = [];
        const autoSurfaced: { email: typeof emails[0]; ruleId?: string; reason: string }[] = [];

        for (const email of emails) {
          const result = matchItemAgainstRules(
            {
              sourceType: "email",
              sourceId: email.messageId || "",
              sender: email.from,
              subject: email.subject,
              snippet: email.snippet,
            },
            userRules
          );
          if (result.verdict === "suppress") {
            console.log(`[EmailAlert] Suppressed "${email.subject}" by rule ${result.matchedRuleId}`);
            continue;
          }
          if (result.verdict === "surface") {
            autoSurfaced.push({ email, ruleId: result.matchedRuleId, reason: "Matched your surface rule" });
            continue;
          }
          filteredEmails.push(email);
        }

        for (const { email, ruleId, reason } of autoSurfaced) {
          const suggestedActions = email.messageId
            ? [
                { label: "Archive", actionType: "archive" },
                { label: "Star", actionType: "mark_important" },
                { label: "Save as Task", actionType: "save_as_task" },
                { label: "Dismiss", actionType: "dismiss" },
              ]
            : [
                { label: "Save as Task", actionType: "save_as_task" },
                { label: "Dismiss", actionType: "dismiss" },
              ];
          try {
            await db.insert(schema.inboxItems).values({
              userId: link.userId,
              sourceType: "email",
              sourceId: email.messageId ? `gmail:${email.messageId}` : `gmail:${email.subject}`,
              subject: email.subject,
              sender: email.from,
              snippet: email.snippet,
              jarvisReason: reason,
              suggestedActions,
              matchedRuleId: ruleId || null,
            });
          } catch {}
          const senderName = email.from.replace(/<.*>/, '').trim() || email.from;
          const msg = `📧 Surfaced for you:\nFrom: ${senderName}\n"${email.subject}"\n\n${email.snippet.slice(0, 150)}${email.snippet.length > 150 ? '...' : ''}\n\nJarvis: ${reason}`;
          await notifyUser(link.userId, "email_alert", msg);
          logInteraction(link.userId, "notification", "outbound", msg, "email_surfaced").catch(() => {});
        }

        if (filteredEmails.length === 0) continue;

        const emailList = filteredEmails.map((e, i) =>
          `${i}. From: ${e.from}\n   Subject: "${e.subject}"\n   Preview: ${e.snippet}`
        ).join('\n\n');

        let flagged: { index: number; reason: string }[] = [];
        try {
          const classification = await openai.chat.completions.create({
            model: 'gpt-5-mini',
            messages: [
              {
                role: 'system',
                content: `You review emails and decide which need IMMEDIATE user attention. Alert = true ONLY for:
- Urgent reply needed from a real person they know
- Deadline TODAY or TOMORROW explicitly mentioned
- Meeting cancelled, moved, or significantly changed
- Time-sensitive action required today
- Important client/boss/colleague needing a response soon

Alert = false for:
- Newsletters, marketing, promotions, sales
- Automated notifications, receipts, shipping updates
- Social media notifications
- No-reply or automated senders
- General FYI or informational emails

Return ONLY a JSON array of flagged emails (only include alert=true ones):
[{"index": 0, "reason": "brief reason why this is urgent"}]
Return [] if nothing is urgent.`,
              },
              {
                role: 'user',
                content: `Emails received in the last 30 minutes:\n\n${emailList}`,
              },
            ],
            max_completion_tokens: 2000,
          });

          const raw = classification.choices[0]?.message?.content || '[]';
          const jsonMatch = raw.match(/\[[\s\S]*\]/);
          if (jsonMatch) flagged = JSON.parse(jsonMatch[0]);
        } catch (err) {
          console.error('[EmailAlert] Classification failed:', err);
          continue;
        }

        for (const flag of flagged) {
          const email = filteredEmails[flag.index];
          if (!email) continue;
          const senderName = email.from.replace(/<.*>/, '').trim() || email.from;

          const suggestedActions = email.messageId
            ? [
                { label: "Archive", actionType: "archive" },
                { label: "Save as Task", actionType: "save_as_task" },
                { label: "Dismiss", actionType: "dismiss" },
              ]
            : [
                { label: "Save as Task", actionType: "save_as_task" },
                { label: "Dismiss", actionType: "dismiss" },
              ];
          try {
            await db.insert(schema.inboxItems).values({
              userId: link.userId,
              sourceType: "email",
              sourceId: email.messageId ? `gmail:${email.messageId}` : `gmail:${email.subject}`,
              subject: email.subject,
              sender: email.from,
              snippet: email.snippet,
              jarvisReason: flag.reason,
              suggestedActions,
            });
          } catch {}

          const msg = `📧 Email needs your attention:\nFrom: ${senderName}\n"${email.subject}"\n\n${email.snippet.slice(0, 150)}${email.snippet.length > 150 ? '...' : ''}\n\nJarvis: ${flag.reason}`;
          await notifyUser(link.userId, "email_alert", msg);
          logInteraction(link.userId, "notification", "outbound", msg, "email_alert").catch(() => {});
          console.log(`[EmailAlert] Alerted user ${link.userId}: "${email.subject}"`);
        }
      }
    } catch (err) {
      console.error('[EmailAlert] Scanner error:', err);
    }
  };

  setInterval(runScan, SCAN_INTERVAL_MS);
  console.log('Email alert scanner started (30-min interval)');
}
