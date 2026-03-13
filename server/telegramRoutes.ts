import type { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import * as schema from "@shared/schema";
import { sendMessage, isTelegramConfigured, getUpdates, downloadTelegramFile, downloadTelegramFileBuffer } from "./integrations/telegram";
import { getRecentEmailCommitments, getEmailsSince, getStarredFollowUpEmails, gmailModifyMessage } from "./integrations/gmail";
import { getGoogleCalendarEvents } from "./integrations/googleCalendar";
import { getValidGoogleTokens } from "./userTokenStore";
import { tavilySearch, formatSearchResults } from "./integrations/search";
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
    let googleAccessToken: string | null = null;

    const [goalsRow, statsRow, lcRow, chatRow, commitmentsRows, googleTokens, prefsRow] = await Promise.allSettled([
      db.select().from(schema.goals).where(eq(schema.goals.userId, userId)).limit(1),
      db.select().from(schema.stats).where(eq(schema.stats.userId, userId)).limit(1),
      db.select().from(schema.lifeContext).where(eq(schema.lifeContext.userId, userId)).limit(1),
      db.select().from(schema.chatHistory).where(eq(schema.chatHistory.userId, userId)).limit(1),
      db.select().from(schema.commitments)
        .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
        .orderBy(desc(schema.commitments.extractedAt)).limit(10),
      getValidGoogleTokens(userId),
      db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)).limit(1),
    ]);

    let userTimezone = 'America/New_York';

    if (goalsRow.status === 'fulfilled') userGoals = (goalsRow.value[0]?.data as any[]) || [];
    if (statsRow.status === 'fulfilled') userStats = statsRow.value[0]?.data || {};
    if (lcRow.status === 'fulfilled') userLifeContext = lcRow.value[0]?.data || null;
    if (chatRow.status === 'fulfilled') chatMessages = (chatRow.value[0]?.data as any[]) || [];
    if (commitmentsRows.status === 'fulfilled') userCommitments = commitmentsRows.value;
    if (prefsRow.status === 'fulfilled') {
      const prefs = (prefsRow.value[0]?.data as any) || {};
      if (prefs.timezone) userTimezone = prefs.timezone;
    }

    const nowForDateKey = new Date();
    const localForDateKey = new Date(nowForDateKey.toLocaleString('en-US', { timeZone: userTimezone }));
    const dateKey = `${localForDateKey.getFullYear()}-${String(localForDateKey.getMonth() + 1).padStart(2, '0')}-${String(localForDateKey.getDate()).padStart(2, '0')}`;

    let todayPlan: any = null;
    try {
      const planRows = await db.select().from(schema.plans)
        .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, dateKey))).limit(1);
      todayPlan = planRows[0]?.data as any || null;
    } catch {}


    if (googleTokens.status === 'fulfilled' && googleTokens.value.length > 0) {
      gmailConnected = true;
      const token = googleTokens.value[0];
      googleAccessToken = token;
      const today = new Date().toISOString().split('T')[0];
      console.log(`[Telegram] Fetching Gmail+Calendar for user ${userId}, token length: ${token?.length}`);

      const [emailResult, calResult] = await Promise.allSettled([
        getRecentEmailCommitments(14, token),
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
      ? userCommitments.map((c: any) => `- [id:${c.id}] "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ''}`).join('\n')
      : '';

    const calendarText = calendarEvents.length > 0
      ? calendarEvents.slice(0, 8).map((e: any) => `- ${e.time ? e.time + ': ' : ''}${e.title}`).join('\n')
      : '';

    const gmailSection = gmailItems.length > 0
      ? `## Recent Emails (last 14 days from Gmail)\n` +
        gmailItems.slice(0, 100).map((i: any) => `- [id:${i.id}] From: ${i.from || 'unknown'} | "${i.subject}" — ${i.snippet}`).join('\n') +
        `\n(Refer to these directly when asked. Do not say you cannot access email — you have the data above. Use the gmail_action tool with the message id to act on emails when asked.)`
      : gmailConnected
        ? `## Recent Emails\nGmail is connected but no emails found in the last 7 days.`
        : `## Recent Emails\nGmail not connected — if asked about emails, let the user know.`;

    const localNow = new Date(now.toLocaleString('en-US', { timeZone: userTimezone }));
    const localHour = localNow.getHours();
    const localMinute = localNow.getMinutes();
    const localDay = localNow.getDay();
    const scheduleSlots: { hour: number; minute: number; label: string }[] = [
      { hour: 8, minute: 0, label: '8:00 AM morning check-in' },
      { hour: 10, minute: 0, label: '10:00 AM commitment check (only if items due/overdue)' },
      { hour: 20, minute: 0, label: '8:00 PM evening recap' },
    ];
    if (localDay === 0) {
      scheduleSlots.push({ hour: 19, minute: 0, label: '7:00 PM weekly review (Sunday)' });
      scheduleSlots.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
    }
    const nextSlot = scheduleSlots.find(s => s.hour > localHour || (s.hour === localHour && s.minute > localMinute));
    const nextScheduledText = nextSlot
      ? `Next scheduled notification: ${nextSlot.label} (${userTimezone})`
      : 'All scheduled notifications for today have already passed. Next: 8:00 AM tomorrow morning check-in';

    const systemPrompt = `You are GamePlan Coach Jarvis — a sharp, supportive personal productivity coach. You're responding via Telegram, so keep messages SHORT (2-4 sentences max). Use plain text, no markdown headers.

Today is ${dayOfWeek}, ${dateStr}. User's timezone: ${userTimezone}.

## What You Do Automatically (you do NOT control these — the system runs them)
- 8:00 AM: Morning check-in with today's plan and inbox highlights
- 10:00 AM: Commitment accountability check (ONLY fires if there are items due today or overdue — otherwise skipped)
- 8:00 PM: Evening recap of what was completed and what's still open
- 7:00 PM Sundays: Weekly review
- Every 30 minutes: Email scanner checks Gmail and sends a Telegram alert ONLY for genuinely urgent emails
All times are in the user's timezone (${userTimezone}). These fire automatically — you cannot pause, delay, reschedule, or skip them. You have no log of whether a specific notification was actually sent.
${nextScheduledText}

## What You Must NEVER Do
- NEVER claim you "paused", "held", "scheduled", "decided to wait", or took any autonomous action regarding notifications. You don't have that ability.
- NEVER invent a narrative about your own past behavior or past conversations you don't have in your message history below.
- If asked whether a notification went out, be honest: "I don't have a record of which notifications fired. The morning check-in is scheduled for 8 AM — I can tell you what's in your data right now."
- If asked about past conversations not in your message history, say so. Don't fabricate.

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

## Task Management
You can manage the user's tasks and commitments using the manage_tasks tool:
- Add tasks to today's plan (add_plan_task)
- Add commitments with optional due dates (add_commitment)
- Mark commitments as done using their [id:...] (complete_commitment)
- List today's tasks and open commitments (list_tasks)
When the user asks to add, complete, or list tasks/commitments, use the manage_tasks tool.

Be direct, specific, actionable. No fluff. You have full access to the user's email and calendar data above — use it. Respond in the same language the user writes in.`;

    let reply = "Sorry, I couldn't generate a response right now.";
    try {
      const userMessageContent = imageUrl
        ? [
            { type: "text" as const, text: userText || "What do you see in this image? Give me your thoughts and any relevant actions." },
            { type: "image_url" as const, image_url: { url: imageUrl } },
          ]
        : userText;

      const searchTool = {
        type: "function" as const,
        function: {
          name: "search_web",
          description: "Search the web for current information, news, weather, prices, recent events, or anything requiring up-to-date data.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The search query" },
            },
            required: ["query"],
          },
        },
      };

      const gmailActionTool = {
        type: "function" as const,
        function: {
          name: "gmail_action",
          description: "Perform an action on a Gmail email. Use the message id from the email list provided in the system prompt.",
          parameters: {
            type: "object",
            properties: {
              message_id: { type: "string", description: "The Gmail message ID (from [id:...] in the email list)" },
              action: { type: "string", enum: ["star", "unstar", "archive", "mark_read", "mark_unread", "spam", "trash"], description: "The action to perform on the email" },
            },
            required: ["message_id", "action"],
          },
        },
      };

      const manageTasksTool = {
        type: "function" as const,
        function: {
          name: "manage_tasks",
          description: "Manage the user's daily plan tasks and commitments. Use this to add tasks to today's plan, add commitments, complete/resolve commitments, or list current tasks and commitments.",
          parameters: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["add_plan_task", "add_commitment", "complete_commitment", "list_tasks"],
                description: "The action to perform",
              },
              title: {
                type: "string",
                description: "Title of the task (required for add_plan_task)",
              },
              content: {
                type: "string",
                description: "Content of the commitment (required for add_commitment)",
              },
              due_date: {
                type: "string",
                description: "Due date in YYYY-MM-DD format (optional, for add_commitment)",
              },
              commitment_id: {
                type: "string",
                description: "The commitment ID from [id:...] (required for complete_commitment)",
              },
            },
            required: ["action"],
          },
        },
      };

      const baseMessages: any[] = [
        { role: "system", content: systemPrompt },
        ...recentMessages.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: "user", content: userMessageContent },
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: baseMessages,
        tools: [searchTool, gmailActionTool, manageTasksTool],
        tool_choice: "auto",
        max_completion_tokens: 2000,
      });

      const finishReason = response.choices?.[0]?.finish_reason;
      console.log(`[Telegram] OpenAI finish_reason: ${finishReason}`);

      if (finishReason === 'tool_calls') {
        const toolCall = response.choices[0].message.tool_calls?.[0];
        if (toolCall?.function?.name === 'search_web') {
          let searchResult = 'Search unavailable right now.';
          try {
            const args = JSON.parse(toolCall.function.arguments);
            console.log(`[Telegram] Web search: "${args.query}"`);
            const results = await tavilySearch(args.query);
            searchResult = formatSearchResults(results);
            console.log(`[Telegram] Search returned ${results.results.length} results`);
          } catch (searchErr: any) {
            console.error('[Telegram] Search failed:', searchErr.message);
          }

          const followUp = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
              ...baseMessages,
              response.choices[0].message,
              { role: "tool" as const, tool_call_id: toolCall.id, content: searchResult },
            ],
            max_completion_tokens: 2000,
          });
          console.log(`[Telegram] Follow-up finish_reason: ${followUp.choices?.[0]?.finish_reason}`);
          reply = followUp.choices[0]?.message?.content || reply;
        } else if (toolCall?.function?.name === 'gmail_action') {
          let actionResult = 'Gmail action failed.';
          try {
            const args = JSON.parse(toolCall.function.arguments);
            console.log(`[Telegram] Gmail action: ${args.action} on message ${args.message_id}`);

            if (!googleAccessToken) {
              actionResult = 'Gmail is not connected. Ask the user to connect their Google account first.';
            } else if (gmailItems.length > 0 && !gmailItems.some((e: any) => e.id === args.message_id)) {
              actionResult = `Message ID "${args.message_id}" not found in the current email list. Please use a valid message ID from the emails shown.`;
            } else {
              const actionMap: Record<string, { add: string[]; remove: string[] }> = {
                star: { add: ['STARRED'], remove: [] },
                unstar: { add: [], remove: ['STARRED'] },
                archive: { add: [], remove: ['INBOX'] },
                mark_read: { add: [], remove: ['UNREAD'] },
                mark_unread: { add: ['UNREAD'], remove: [] },
                spam: { add: ['SPAM'], remove: ['INBOX'] },
                trash: { add: ['TRASH'], remove: ['INBOX'] },
              };

              const mapping = actionMap[args.action];
              if (!mapping) {
                actionResult = `Unknown action: ${args.action}`;
              } else {
                await gmailModifyMessage(args.message_id, mapping.add, mapping.remove, googleAccessToken);
                actionResult = `Successfully performed "${args.action}" on the email.`;
                console.log(`[Telegram] Gmail action succeeded: ${args.action} on ${args.message_id}`);
              }
            }
          } catch (gmailErr: any) {
            console.error('[Telegram] Gmail action failed:', gmailErr.message);
            actionResult = `Gmail action failed: ${gmailErr.message}`;
          }

          const followUp = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
              ...baseMessages,
              response.choices[0].message,
              { role: "tool" as const, tool_call_id: toolCall.id, content: actionResult },
            ],
            max_completion_tokens: 2000,
          });
          console.log(`[Telegram] Follow-up finish_reason: ${followUp.choices?.[0]?.finish_reason}`);
          reply = followUp.choices[0]?.message?.content || reply;
        } else if (toolCall?.function?.name === 'manage_tasks') {
          let taskResult = 'Task management action failed.';
          try {
            const args = JSON.parse(toolCall.function.arguments);
            console.log(`[Telegram] manage_tasks action: ${args.action}`);

            if (args.action === 'add_plan_task') {
              if (!args.title) {
                taskResult = 'Error: title is required for add_plan_task';
              } else {
                const tasks = (todayPlan?.tasks as any[]) || [];
                const newTask = {
                  id: crypto.randomUUID(),
                  title: args.title,
                  completed: false,
                };
                tasks.push(newTask);
                const planData = todayPlan ? { ...todayPlan, tasks } : { tasks };
                await db.insert(schema.plans)
                  .values({ userId, date: dateKey, data: planData })
                  .onConflictDoUpdate({
                    target: [schema.plans.userId, schema.plans.date],
                    set: { data: planData, updatedAt: new Date() },
                  });
                todayPlan = planData;
                taskResult = `Added "${args.title}" to today's plan. Today's plan now has ${tasks.length} task(s).`;
                console.log(`[Telegram] Added plan task: "${args.title}"`);
              }
            } else if (args.action === 'add_commitment') {
              if (!args.content) {
                taskResult = 'Error: content is required for add_commitment';
              } else {
                await db.insert(schema.commitments).values({
                  userId,
                  content: args.content,
                  dueDate: args.due_date || null,
                  sourceMessage: `Added via Telegram`,
                });
                taskResult = `Added commitment: "${args.content}"${args.due_date ? ` (due ${args.due_date})` : ''}`;
                console.log(`[Telegram] Added commitment: "${args.content}"`);
              }
            } else if (args.action === 'complete_commitment') {
              if (!args.commitment_id) {
                taskResult = 'Error: commitment_id is required for complete_commitment';
              } else {
                const updated = await db
                  .update(schema.commitments)
                  .set({ status: 'done', resolvedAt: new Date() })
                  .where(and(eq(schema.commitments.id, args.commitment_id), eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
                  .returning({ id: schema.commitments.id });
                if (updated.length > 0) {
                  taskResult = `Marked commitment as done (id: ${args.commitment_id}).`;
                  console.log(`[Telegram] Completed commitment: ${args.commitment_id}`);
                } else {
                  taskResult = `Error: No pending commitment found with id "${args.commitment_id}". Check the commitment ID and try again.`;
                  console.log(`[Telegram] Commitment not found: ${args.commitment_id}`);
                }
              }
            } else if (args.action === 'list_tasks') {
              const planTasks = (todayPlan?.tasks as any[]) || [];
              const pendingCommitments = await db.select().from(schema.commitments)
                .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
                .orderBy(desc(schema.commitments.extractedAt)).limit(10);

              let listing = '';
              if (planTasks.length > 0) {
                listing += "Today's Plan:\n" + planTasks.map((t: any) =>
                  `- ${t.completed ? '✅' : '⬜'} ${t.title}`
                ).join('\n');
              } else {
                listing += "Today's Plan: No tasks yet.";
              }
              listing += '\n\n';
              if (pendingCommitments.length > 0) {
                listing += "Open Commitments:\n" + pendingCommitments.map((c: any) =>
                  `- [id:${c.id}] "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ''}`
                ).join('\n');
              } else {
                listing += "Open Commitments: None.";
              }
              taskResult = listing;
              console.log(`[Telegram] Listed tasks: ${planTasks.length} plan tasks, ${pendingCommitments.length} commitments`);
            } else {
              taskResult = `Unknown action: ${args.action}`;
            }
          } catch (taskErr: any) {
            console.error('[Telegram] manage_tasks failed:', taskErr.message);
            taskResult = `Task management failed: ${taskErr.message}`;
          }

          const followUp = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [
              ...baseMessages,
              response.choices[0].message,
              { role: "tool" as const, tool_call_id: toolCall.id, content: taskResult },
            ],
            max_completion_tokens: 2000,
          });
          console.log(`[Telegram] Follow-up finish_reason: ${followUp.choices?.[0]?.finish_reason}`);
          reply = followUp.choices[0]?.message?.content || reply;
        }
      } else {
        reply = response.choices[0]?.message?.content || reply;
      }
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
        const { speechToText, ensureCompatibleFormat } = await import('./replit_integrations/audio/client');
        const { buffer, format } = await ensureCompatibleFormat(file.buffer);
        const transcript = await speechToText(buffer, format);
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

async function generateProactiveMessage(
  type: string,
  context: {
    tasks?: any[];
    goals?: any[];
    commitments?: any[];
    stats?: any;
    dateKey?: string;
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
  } else if (type === 'weekly') {
    prompt = `Weekly review.
Streak: ${context.stats?.streak || 0} days | XP: ${context.stats?.xp || 0}
Goals: ${goalsText}
Open commitments: ${commitmentList}

Write a sharp weekly summary (3-4 sentences). What's the trend? What needs focus next week? Be honest and direct.`;
  }

  if (!prompt) return null;

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'system',
          content: 'You are GamePlan Coach Jarvis — a direct, sharp, ADHD-friendly productivity coach. Messages go via Telegram. Keep it SHORT (3-4 sentences max). Plain text only, no markdown, no bullet points.',
        },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: 2000,
    });
    return resp.choices[0]?.message?.content || null;
  } catch (err) {
    console.error('[Proactive] AI generation failed:', err);
    return null;
  }
}

export async function startProactiveScheduler(): Promise<void> {
  if (!isTelegramConfigured()) return;

  const SCHEDULE = [
    { type: 'morning', hour: 8, minute: 0 },
    { type: 'commitment_check', hour: 10, minute: 0 },
    { type: 'followup_check', hour: 12, minute: 0 },
    { type: 'evening', hour: 20, minute: 0 },
    { type: 'weekly', dayOfWeek: 0, hour: 19, minute: 0 },
  ];

  const lastSent: Record<string, string> = {};

  setInterval(async () => {
    const now = new Date();

    try {
      const links = await db.select().from(schema.telegramLinks);
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

        for (const schedule of SCHEDULE) {
          if (localHour !== schedule.hour || localMinute !== schedule.minute) continue;
          if (schedule.type === 'weekly' && localDay !== schedule.dayOfWeek) continue;

          const sentKey = `${link.userId}-${schedule.type}-${dateKey}`;
          if (lastSent[sentKey]) continue;
          lastSent[sentKey] = dateKey;

          try {
            if (schedule.type === 'followup_check') {
              const tokens = await getValidGoogleTokens(link.userId).catch(() => []);
              if (!tokens || tokens.length === 0) continue;
              const token = tokens[0];

              const starredEmails = await getStarredFollowUpEmails(token, 3);
              if (starredEmails.length === 0) continue;

              const emailList = starredEmails.slice(0, 10).map((e) => {
                const senderName = e.from.replace(/<.*>/, '').trim() || e.from;
                return `${senderName} (${e.ageDays}d) — "${e.subject}"`;
              }).join('\n');

              const msg = `📬 ${starredEmails.length} starred/important email${starredEmails.length === 1 ? '' : 's'} sitting >3 days:\n\n${emailList}\n\nStill relevant? Reply, archive, or unstar anything you've handled.`;
              console.log(`[Proactive] Sending followup_check to user ${link.userId} (${timezone})`);
              await sendMessage(link.chatId, msg);
              continue;
            }

            let userGoals: any[] = [];
            let todayPlan: any = null;
            let userStats: any = {};
            let commitments: any[] = [];

            const [goalsRow, planRow, statsRow] = await Promise.allSettled([
              db.select().from(schema.goals).where(eq(schema.goals.userId, link.userId)).limit(1),
              db.select().from(schema.plans).where(and(eq(schema.plans.userId, link.userId), eq(schema.plans.date, dateKey))).limit(1),
              db.select().from(schema.stats).where(eq(schema.stats.userId, link.userId)).limit(1),
            ]);
            if (goalsRow.status === 'fulfilled') userGoals = (goalsRow.value[0]?.data as any[]) || [];
            if (planRow.status === 'fulfilled') todayPlan = planRow.value[0]?.data as any;
            if (statsRow.status === 'fulfilled') userStats = statsRow.value[0]?.data || {};
            commitments = await getCommitmentsForUser(link.userId);

            const tasks = todayPlan?.tasks || [];

            const message = await generateProactiveMessage(schedule.type, {
              tasks,
              goals: userGoals,
              commitments,
              stats: userStats,
              dateKey,
            });

            if (message) {
              console.log(`[Proactive] Sending ${schedule.type} to user ${link.userId} (${timezone})`);
              await sendMessage(link.chatId, message);
            }
          } catch (err) {
            console.error(`[Proactive] Error for user ${link.userId}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('[Proactive] Scheduler error:', err);
    }
  }, 60 * 1000);

  console.log('Telegram proactive scheduler started');
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
                await sendMessage(link.chatId, fullMsg);
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
  if (!isTelegramConfigured()) return;

  const SCAN_INTERVAL_MS = 30 * 60 * 1000;

  const runScan = async () => {
    try {
      const links = await db.select().from(schema.telegramLinks);
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

        const emailList = emails.map((e, i) =>
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
          const email = emails[flag.index];
          if (!email) continue;
          const senderName = email.from.replace(/<.*>/, '').trim() || email.from;
          const msg = `📧 Email needs your attention:\nFrom: ${senderName}\n"${email.subject}"\n\n${email.snippet.slice(0, 150)}${email.snippet.length > 150 ? '...' : ''}\n\nJarvis: ${flag.reason}`;
          await sendMessage(link.chatId, msg);
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
