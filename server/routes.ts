import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import { db } from "./db";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import * as schema from "@shared/schema";
import { userMemories, morningVoiceNotes, userPreferences, proactiveQuestionsSent, inboxItems, inboxRules, userDocuments } from "@shared/schema";
import { processDocument, getUserDocumentContext, SUPPORTED_MIME_TYPES, SUPPORTED_EXTENSIONS, MAX_DOCS_PER_USER } from "./documentProcessor";
import { resizeTask, generateSmartPlan, unblockTask } from "./ai";
import {
  getGoogleCalendarEvents,
  checkGoogleCalendarConnection,
  createGoogleCalendarEvent,
} from "./integrations/googleCalendar";
import {
  getOutlookCalendarEvents,
  checkOutlookConnection,
  createOutlookCalendarEvent,
  sendOutlookEmail,
  getRecentOutlookEmails,
} from "./integrations/outlook";
import {
  checkGmailConnection,
  getRecentEmailCommitments,
  createGmailDraft,
  sendGmailEmail,
} from "./integrations/gmail";
import { getSlackMessages } from "./integrations/slack";
import { authRouter, authMiddleware } from "./auth";
import { mobileAuthRouter } from "./mobileAuthRoutes";
import { registerDataRoutes } from "./dataRoutes";
import { registerTelegramRoutes } from "./telegramRoutes";
import { registerChannelRoutes } from "./channels/routes";
import { registerDiscordScheduleRoutes } from "./discord/schedulesRoutes";
import { registerDownloadRoutes } from "./downloadRoutes";
import { isIntegrationOwner, claimIntegrationOwnership } from "./integrationOwner";
import { oauthRouter, oauthCallbackRouter } from "./oauthRoutes";
import { getValidGoogleTokens, getValidGoogleToken, getValidMicrosoftToken, getUserTokens, getUserToken, getUserOAuthStatus } from "./userTokenStore";
import { tavilySearch, formatSearchResults } from "./integrations/search";
import { logInteraction, getRecentInteractions, formatInteractionTimeline } from "./interactionLog";
import { extractAndStore } from "./memory/extractor";
import { getSoul, getSoulPromptBlock, regenerateSoul, setManualOverride, setSoulContent } from "./memory/soul";
import { listPeople, deletePerson } from "./memory/people";
import { isUserPaired, sendDaemonOp, pingDaemon, getOpAuditLog, isDaemonActionAllowed, isAndroidDaemonActive, isAndroidDaemonActionAllowed, getRecentPhoneNotifications, getDaemonDeviceMeta, type AndroidDaemonAction } from "./daemon/bridge";
import type { DaemonAction, DaemonOp } from "./daemon/bridge";
import { telegramLinks, channelLinks } from "@shared/schema";
import { connectChannelTool } from "./agent/tools/connectChannel";
import { YoutubeTranscript } from "youtube-transcript/dist/youtube-transcript.esm.js";
import ytSearch from "yt-search";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Temporary in-memory screenshot store keyed by UUID (30-minute TTL)
const screenshotStore = new Map<string, { data: Buffer; expires: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of screenshotStore) {
    if (entry.expires < now) screenshotStore.delete(id);
  }
}, 5 * 60 * 1000);

const COACHING_FRAMEWORKS = `## Coaching Frameworks You Draw From
Apply these when relevant — reference them by name:
- Atomic Habits (James Clear): Habits = cue + craving + response + reward. Small 1% improvements compound. Environment design > willpower.
- Deep Work (Cal Newport): Protect deep focus blocks. Shallow work is the enemy. Produce at a high level.
- 80/20 Principle (Pareto): 20% of efforts produce 80% of results. Identify and double down on the 20%.
- Extreme Ownership (Jocko Willink): No excuses. Own every outcome. Simplify plans. Cover and move.
- The ONE Thing (Gary Keller): What is the one thing that makes everything else easier or unnecessary?
- OKRs (Measure What Matters): Objectives + Key Results. Ambitious goals + measurable milestones.
- 7 Habits (Stephen Covey): Be proactive. Begin with the end in mind. First things first. Sharpen the saw.
- Essentialism (Greg McKeown): Less but better. Eliminate the trivial many. Protect your highest contribution.
- ADHD Strategies: Task decomposition. External accountability. Body doubling. Time-blocking. Momentum before perfectionism.
- Stoicism (Marcus Aurelius): Focus only on what you control. Obstacles are the way. Memento mori.
- First Principles (Musk): Strip back assumptions. Reason from fundamentals. Don't copy — derive.
When you reference a framework, name the author/book naturally: "Per Atomic Habits..." or "This is an OKR problem..."`;

const PERSONA_BLOCKS: Record<string, string> = {
  sharp: `## Your Coaching Style: Sharp Advisor\nYou are a direct, no-fluff executive advisor. Diagnose fast. Prescribe specifically. Apply 80/20 and First Principles instinctively. Skip pleasantries. If you see the real problem, name it immediately.`,
  drill: `## Your Coaching Style: Drill Sergeant\nYou are Jocko Willink meets David Goggins. Zero tolerance for excuses. Name them directly. Apply Extreme Ownership — the user is responsible for everything. Push hard. Short, punchy sentences. End with a direct command.`,
  mentor: `## Your Coaching Style: Wise Mentor\nYou are a patient, systems-thinking mentor. You care about the long game. Apply Atomic Habits and Deep Work thinking. You ask Socratic questions. You help the user build systems that make success inevitable.`,
  strategist: `## Your Coaching Style: Business Strategist\nYou are a high-leverage business partner. You think in ROI, leverage, and compounding returns. Apply OKR thinking. Every decision should be examined for 10x potential. Cut low-value work ruthlessly.`,
  flow: `## Your Coaching Style: Flow Coach\nYou are a gentle, ADHD-aware coach. You reduce friction. You chunk tasks into tiny pieces. You celebrate momentum. You never overwhelm. You understand that motivation follows action, not the other way around. You ask "what's the smallest next step?"`,
};

function getPersonaBlock(coachingMode?: string): string {
  return PERSONA_BLOCKS[coachingMode || 'sharp'] || PERSONA_BLOCKS.sharp;
}

const morningNoteSummaryCache = new Map<string, { summary: string; date: string }>();

async function getUserLocalDate(userId: string): Promise<string> {
  try {
    const prefs = await db.select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    const tz = (prefs[0]?.data as Record<string, string>)?.timezone || 'America/New_York';
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function getMorningNoteSummary(userId: string): Promise<string> {
  const today = await getUserLocalDate(userId);
  const cached = morningNoteSummaryCache.get(userId);
  if (cached && cached.date === today) return cached.summary;

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffDate = thirtyDaysAgo.toISOString().slice(0, 10);

    const notes = await db.select()
      .from(morningVoiceNotes)
      .where(and(
        eq(morningVoiceNotes.userId, userId),
        gte(morningVoiceNotes.recordedAt, cutoffDate)
      ))
      .orderBy(desc(morningVoiceNotes.recordedAt))
      .limit(30);

    if (notes.length === 0) return '';

    const moodCounts: Record<string, number> = {};
    const allThemes: Record<string, number> = {};
    const allBlockers: Record<string, number> = {};
    const recentIntentions: string[] = [];

    for (const note of notes) {
      moodCounts[note.moodSignal] = (moodCounts[note.moodSignal] || 0) + 1;
      const themes = (note.themes as string[]) || [];
      for (const t of themes) allThemes[t] = (allThemes[t] || 0) + 1;
      const blockers = (note.blockers as string[]) || [];
      for (const b of blockers) allBlockers[b] = (allBlockers[b] || 0) + 1;
      if (note.intention) recentIntentions.push(note.intention);
    }

    const topMoods = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, c]) => `${m} (${c}x)`).join(', ');
    const topThemes = Object.entries(allThemes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, c]) => `${t} (${c}x)`).join(', ');
    const topBlockers = Object.entries(allBlockers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, c]) => `${b} (${c}x)`).join(', ');

    let summary = `\n## Morning Voice Note Patterns (last ${notes.length} days)\n`;
    summary += `- Mood trend: ${topMoods}\n`;
    if (topThemes) summary += `- Recurring themes: ${topThemes}\n`;
    if (topBlockers) summary += `- Common blockers: ${topBlockers}\n`;
    if (recentIntentions.length > 0) summary += `- Recent intentions: ${recentIntentions.slice(0, 3).map(i => `"${i}"`).join(', ')}\n`;
    summary += `Use these patterns to provide personalized coaching. Reference specific trends when relevant.`;

    morningNoteSummaryCache.set(userId, { summary, date: today });
    return summary;
  } catch {
    return '';
  }
}

function buildCoachSystemPrompt(goals: any[], stats: any, history: any[], calendarEvents: any[] = [], lifeContext?: any, gmailItems?: any[], gmailConnected?: boolean, slackMessages?: any[], slackConnected?: boolean, commitmentsList?: any[], coachingMode?: string, memories?: { content: string; category: string }[], telegramMessages?: any[], telegramConnected?: boolean, morningNoteSummary?: string, documentsContext?: string, crossChannelContext?: string, soulBlock?: string, daemonSection?: string): string {
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

  const documentsSection = documentsContext || '';

  const commitmentsSection = commitmentsList && commitmentsList.length > 0
    ? `\n## Open Commitments (user said they would do these)\n` +
      commitmentsList.filter((c: any) => c.status === 'pending').slice(0, 10)
        .map((c: any) => `- "${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ''}`)
        .join('\n') +
      `\nIf relevant, ask about progress on these commitments. Hold the user accountable to what they promised.`
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

  const slackSection = slackConnected
    ? (slackMessages && slackMessages.length > 0
        ? `\n## Recent Slack Messages (last 7 days)\n` +
          slackMessages.slice(0, 50).map((m: any) => {
            const dateStr = m.timestamp ? new Date(m.timestamp).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '';
            const channelLabel = m.channelType === 'dm' ? 'DM' : m.channelType === 'group' ? 'Group' : `#${m.channel}`;
            return `- [${dateStr}] [${channelLabel}] ${m.user}: ${m.text}`;
          }).join('\n') +
          `\n(Use these to identify commitments, follow-ups, and unresolved discussions. Treat Slack messages like emails — surface actionable items without asking for more info.)`
        : `\n## Recent Slack Messages\nSlack is connected but no messages were found in the last 7 days.`)
    : '';

  const memoriesSection = (() => {
    if (!memories || memories.length === 0) return '';
    const categoryLabels: Record<string, string> = {
      personality: 'Personality & Communication',
      values: 'Values & Motivations',
      work_style: 'Work Style & Patterns',
      accomplishment: 'Accomplishments & Wins',
      goal_discovered: 'Discovered Goals',
      relationship: 'Key People & Relationships',
      pattern: 'Recurring Patterns',
      preference: 'Preferences',
      fact: 'General Facts',
      goal: 'Goals',
      achievement: 'Achievements',
    };
    const grouped: Record<string, string[]> = {};
    for (const m of memories) {
      const cat = m.category || 'fact';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(m.content);
    }
    let section = '\n## What I Know About You (from past conversations)';
    for (const [cat, items] of Object.entries(grouped)) {
      const label = categoryLabels[cat] || cat;
      section += `\n### ${label}\n${items.map(i => `- ${i}`).join('\n')}`;
    }
    return section;
  })();

  const telegramSection = telegramConnected
    ? (telegramMessages && telegramMessages.length > 0
        ? `\n## Recent Telegram Group Messages (last 7 days)\n` +
          telegramMessages.slice(0, 50).map((m: any) => {
            const dateStr = m.timestamp ? new Date(m.timestamp).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '';
            return `- [${dateStr}] [${m.chatTitle || 'Group'}] ${m.fromUser}: ${m.text}`;
          }).join('\n') +
          `\n(Use these to identify commitments, follow-ups, and context. Treat like Slack messages.)`
        : `\n## Recent Telegram Group Messages\nTelegram is connected but no group messages were found in the last 7 days.`)
    : '';

  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const personaBlock = getPersonaBlock(coachingMode);

  return `You are GamePlan Coach — a sharp, supportive personal productivity coach embedded in the GamePlan app. You know this user's goals, habits, and patterns intimately. You give specific, actionable advice — not generic motivational fluff.

Today is ${dayOfWeek}, ${dateStr}.
${crossChannelContext || ''}

${COACHING_FRAMEWORKS}

${personaBlock}
${soulBlock && soulBlock.trim() ? soulBlock : memoriesSection}

## User Profile
- Current streak: ${stats.streak || 0} days
- Best streak: ${stats.bestStreak || 0} days
- Total tasks completed: ${stats.totalCompleted || 0}
- Total XP earned: ${stats.xp || 0}
- Task completion rate (last 7 days): ${completionRate}% (${completedHistory.length} completed, ${skippedHistory.length} skipped)
${strugglingCategories.length > 0 ? `- Struggling most with: ${strugglingCategories.join(', ')}` : ''}${soulBlock && soulBlock.trim() ? '' : lifeContextSection}${documentsSection}

## Active Goals
${goalsText}

## Today's Calendar
${calendarText}${gmailSection}${slackSection}${telegramSection}

## Recent Activity (last 7 days)
- Completed: ${recentCompleted}
- Left undone: ${recentSkipped}
${commitmentsSection}${morningNoteSummary || ''}
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
- Respond in the same language the user writes in.

## Email Drafting
When asked to write or draft an email, format your response like this:
---EMAIL DRAFT---
To: [recipient]
Subject: [subject line]
Body:
[email body]
---END DRAFT---
Then add a brief note like "I've formatted this as a draft — tap 'Save to Drafts' to send it to your Gmail."

## Actuation — You Have Real Hands
You can take real actions on connected services. Use these tools proactively when the user asks:

- **check_connections** — Always call this before claiming a service is (or isn't) connected. Never make assumptions about connection status.
- **generate_reconnect_link** — When a Google or Microsoft account is disconnected and the user wants to reconnect, call this to generate a tappable OAuth button. After calling it, say something like "I've added a button below — tap it to reconnect." Do NOT write the URL in your message text.
- **connect_channel** — When the user asks to connect Telegram, WhatsApp, Slack, or Discord, call this to generate a connection code. After calling it, the tool result JSON contains a "code" field for Telegram. For Telegram: say "I've added a button below — tap it to open Telegram, then type the code **[CODE]** in the chat." (replace [CODE] with the actual code value from the tool result). Do NOT write raw URLs. Supported channels: telegram, whatsapp, slack, discord.
- **create_calendar_event** — When the user says "block time", "schedule a meeting", "add to my calendar" — call this to actually create the event. Don't describe what you'd do, do it.
- **fetch_emails** — Fetch inbox emails on demand beyond the ambient context.
- **send_email** — When the user explicitly confirms they want to send an email (not just draft), call this. Always confirm before sending.
- **schedule_jarvis_task** — Schedule a future task for Jarvis to act on at a specific time. Use when the user says "remind me to...", "schedule...", "do X at Y time", or asks Jarvis to take an action later. Always confirm the scheduled time before calling. Supports recurrence (daily, weekly, weekdays, every Monday, etc.).
- **daemon_action** — Execute actions on the user's paired daemon (desktop or Android). ${daemonSection || 'Call check_connections first to determine which daemon type is paired and which actions are available.'}

**Critical rule**: Never claim you can or cannot access a service without first calling check_connections. Never promise to send an email, create a calendar event, or run a daemon command if you haven't verified the service is connected. When a user asks to connect any channel, always call connect_channel rather than giving manual instructions.`;
}

export async function buildPlanFromInputs(body: any): Promise<{
  reasoning: string;
  tasks: Array<{ title: string; category: string; priority: string; duration?: number; time?: string; description?: string }>;
}> {
  const { goals, calendarEvents, gmailItems, brainDump, completionHistory, energyLevel, coachingMode, existingTasks, userId } = body;

  const goalsText = Array.isArray(goals) && goals.length > 0
    ? goals.map((g: any) => `- ${g.title} (${g.category}): ${g.current}/${g.target} ${g.unit} — ${Math.round((g.current / Math.max(g.target, 1)) * 100)}% complete`).join('\n')
    : 'No goals set';

  const calendarText = Array.isArray(calendarEvents) && calendarEvents.length > 0
    ? calendarEvents.map((e: any) => `- ${e.time ? e.time + ': ' : ''}${e.title}${e.description ? ' (' + e.description + ')' : ''}`).join('\n')
    : 'No calendar events today';

  const gmailText = Array.isArray(gmailItems) && gmailItems.length > 0
    ? gmailItems.slice(0, 20).map((e: any) => `- From: ${e.from || 'unknown'} | "${e.subject}" — ${e.snippet}`).join('\n')
    : 'No emails available';

  const brainDumpText = Array.isArray(brainDump) && brainDump.length > 0
    ? brainDump.map((b: any) => `- ${b.text || b}`).join('\n')
    : 'No brain dump items';

  const historyText = Array.isArray(completionHistory) && completionHistory.length > 0
    ? (() => {
        const completed = completionHistory.filter((h: any) => h.completed).slice(0, 8);
        const skipped = completionHistory.filter((h: any) => !h.completed).slice(0, 8);
        return `Completed recently: ${completed.map((h: any) => h.title).join(', ') || 'none'}\nLeft undone recently: ${skipped.map((h: any) => h.title).join(', ') || 'none'}`;
      })()
    : 'No history available';

  const existingText = Array.isArray(existingTasks) && existingTasks.length > 0
    ? existingTasks.map((t: any) => `- ${t.title} (${t.category}, ${t.priority}${t.completed ? ', done' : ''})`).join('\n')
    : 'No existing tasks';

  const energyDescriptions: Record<number, string> = {
    1: 'Dead — barely functional, needs very light tasks',
    2: 'Low — limited capacity, keep it simple',
    3: 'Okay — moderate capacity, balanced day',
    4: 'Good — solid capacity, can handle challenging work',
    5: 'On Fire — peak capacity, front-load the hard stuff',
  };
  const energyText = typeof energyLevel === 'number' && energyLevel >= 1 && energyLevel <= 5
    ? `${energyLevel}/5 — ${energyDescriptions[energyLevel]}`
    : 'Not checked in';

  const modeInstructions: Record<string, string> = {
    mentor: 'Coaching style: Mentor mode — include Deep Work blocks, be supportive, suggest learning and growth tasks.',
    drill: 'Coaching style: Drill Sergeant mode — aggressive prioritization, no fluff, only the tasks that move the needle.',
    friend: 'Coaching style: Friend mode — balanced and encouraging, mix of productive and enjoyable tasks.',
  };
  const modeText = coachingMode && modeInstructions[coachingMode]
    ? modeInstructions[coachingMode]
    : '';

  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const { buildAiContextSections } = await import("./memory/promptContext");
  const planSeed = [
    ...(Array.isArray(goals) ? goals.slice(0, 3).map((g: any) => g?.title).filter(Boolean) : []),
    ...(Array.isArray(brainDump) ? brainDump.slice(0, 3).map((b: any) => b?.text || b).filter(Boolean) : []),
  ].join(" • ");
  const { soulSection: planSoul, patternSection: planPatterns, memorySection: planMemories } =
    await buildAiContextSections(typeof userId === "string" ? userId : undefined, planSeed);

  const prompt = `You are Jarvis, an autonomous planning AI. Build a realistic, prioritized daily plan for this person.

Today is ${dayOfWeek}, ${dateStr}.${planSoul}${planPatterns}${planMemories}

## Calendar
${calendarText}

## Goals
${goalsText}

## Recent Emails
${gmailText}

## Brain Dump (unprocessed thoughts/tasks)
${brainDumpText}

## Recent History
${historyText}

## Currently Planned Tasks
${existingText}

## Energy Level
${energyText}

${modeText}

## Rules
- Use their actual calendar to block around meetings (leave 10min buffer before/after)
- Pull tasks from brain dump that should be actioned today
- Surface email commitments that need a response or action today
- Apply their goals — at least one task should move a goal forward
- Match energy level to task difficulty
- Generate 4-7 tasks max — quality over quantity
- Be specific: "Review Q2 proposal draft" not "Work on proposal"
- For each task, add a brief description referencing WHY it made the cut (email, goal, deadline, brain dump)
- Do NOT duplicate calendar events as tasks
- Each task needs: title, category (one of: fitness, finance, career, personal, social), priority (high, medium, low), and optionally: duration (minutes), time (e.g. "9:30 AM"), description

Return JSON: { "reasoning": "2-3 sentences on your planning logic, referencing specific data points", "tasks": [{ "title": "...", "category": "...", "priority": "...", "duration": 60, "time": "9:30 AM", "description": "..." }] }
Return ONLY the JSON object.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_completion_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content || '{"reasoning":"","tasks":[]}';
  try {
    const parsed = JSON.parse(content);
    const validCategories = ['fitness', 'finance', 'career', 'personal', 'social'];
    const validPriorities = ['high', 'medium', 'low'];
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.slice(0, 7).map((t: any) => ({
          title: String(t.title || 'Task'),
          category: validCategories.includes(t.category) ? t.category : 'personal',
          priority: validPriorities.includes(t.priority) ? t.priority : 'medium',
          duration: typeof t.duration === 'number' ? t.duration : undefined,
          time: t.time ? String(t.time) : undefined,
          description: t.description ? String(t.description) : undefined,
        }))
      : [];
    return {
      reasoning: String(parsed.reasoning || ''),
      tasks,
    };
  } catch {
    return { reasoning: '', tasks: [] };
  }
}

export async function buildPlanForUser(userId: string): Promise<{
  tasks: Array<{ title: string; category: string; priority: string; duration?: number; time?: string; description?: string }>;
  reasoning: string;
} | null> {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [goalsRow, historyRow, brainDumpRow, lifeContextRow, prefsRow, energyRow] = await Promise.all([
      db.select({ data: schema.goals.data }).from(schema.goals).where(eq(schema.goals.userId, userId)),
      db.select({ data: schema.completionHistory.data }).from(schema.completionHistory).where(eq(schema.completionHistory.userId, userId)),
      db.select({ data: schema.brainDumpInbox.data }).from(schema.brainDumpInbox).where(eq(schema.brainDumpInbox.userId, userId)),
      db.select({ data: schema.lifeContext.data }).from(schema.lifeContext).where(eq(schema.lifeContext.userId, userId)),
      db.select({ data: schema.userPreferences.data }).from(schema.userPreferences).where(eq(schema.userPreferences.userId, userId)),
      db.select({ data: schema.energyCheckins.data }).from(schema.energyCheckins).where(and(eq(schema.energyCheckins.userId, userId), eq(schema.energyCheckins.date, today))),
    ]);

    const goals = (goalsRow[0]?.data as any[]) || [];
    const completionHistory = (historyRow[0]?.data as any[]) || [];
    const brainDump = (brainDumpRow[0]?.data as any[]) || [];
    const prefs = (prefsRow[0]?.data as any) || {};
    const coachingMode = prefs.coachingMode;
    const energyCheckin = energyRow[0]?.data as any;
    const energyLevel = energyCheckin?.energy;

    let calendarEvents: any[] = [];
    let gmailItems: any[] = [];

    try {
      const googleTokens = await getValidGoogleTokens(userId);
      if (googleTokens.length > 0) {
        const startTime = new Date(today + 'T00:00:00').toISOString();
        const endTime = new Date(today + 'T23:59:59').toISOString();
        const events = await getGoogleCalendarEvents(today, startTime, endTime, googleTokens[0]);
        calendarEvents = events.map((e: any) => ({
          title: e.title,
          time: e.start ? new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : undefined,
          description: e.location || e.description,
        }));
      }
    } catch {}

    try {
      const googleTokens = await getValidGoogleTokens(userId);
      if (googleTokens.length > 0) {
        gmailItems = await getRecentEmailCommitments(7, googleTokens[0]);
      }
    } catch {}

    const result = await buildPlanFromInputs({
      goals: goals.map((g: any) => ({
        title: g.title,
        category: g.category,
        current: g.current,
        target: g.target,
        unit: g.unit,
      })),
      calendarEvents,
      gmailItems,
      brainDump,
      completionHistory,
      energyLevel: energyLevel ?? 3,
      coachingMode,
      existingTasks: [],
      userId,
    });

    if (!result || result.tasks.length === 0) return null;
    return result;
  } catch (err) {
    console.error(`buildPlanForUser failed for ${userId}:`, err);
    return null;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.use("/api/auth", authRouter);
  app.use("/api/auth/mobile", mobileAuthRouter);
  app.use("/api/oauth", oauthCallbackRouter);
  registerDownloadRoutes(app);

  // Public screenshot endpoint — IDs are random/opaque with 30-min TTL (no auth header needed by Image component)
  app.get("/api/daemon/screenshot/:id", (req: Request, res: Response) => {
    const entry = screenshotStore.get(req.params.id);
    if (!entry || entry.expires < Date.now()) {
      return res.status(404).json({ error: 'Screenshot not found or expired' });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(entry.data);
  });

  app.use(authMiddleware);
  app.use("/api/oauth", oauthRouter);

  registerDataRoutes(app);
  registerTelegramRoutes(app);
  registerChannelRoutes(app);
  registerDiscordScheduleRoutes(app);

  app.get("/api/discord/status", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const links = await db.select().from(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, 'discord')));
      res.json({ connected: links.length > 0 });
    } catch (error) {
      console.error("Error getting Discord status:", error);
      res.status(500).json({ error: "Failed to get Discord status" });
    }
  });

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
        userId: (req as any).userId,
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

  app.post("/api/coach/build-plan", async (req: Request, res: Response) => {
    try {
      const result = await buildPlanFromInputs(req.body);
      res.json(result);
    } catch (error) {
      console.error("Error building plan:", error);
      res.status(500).json({ error: "Failed to build plan" });
    }
  });

  app.post("/api/coach/break-down-task", async (req: Request, res: Response) => {
    try {
      const { title, description } = req.body;
      if (!title) return res.status(400).json({ error: "title is required" });

      const prompt = `Break down the following task into exactly 3-5 clear, actionable sub-steps that can each be completed independently.

Task: "${title}"${description ? `\nContext: ${description}` : ""}

Return JSON only — no markdown, no explanation:
{
  "subtasks": [
    { "title": "concise action-verb sub-task", "category": "work|personal|health|finance|social|learning", "priority": "high|medium|low" }
  ]
}

Rules:
- Each sub-task title should start with a verb (e.g. "Write", "Review", "Send", "Schedule")
- Keep each title under 60 characters
- Choose category that best fits the subtask
- Assign priority based on urgency/importance relative to the overall task`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 600,
      });

      const content = response.choices[0]?.message?.content || '{"subtasks":[]}';
      const parsed = JSON.parse(content);
      const subtasks = Array.isArray(parsed.subtasks) ? parsed.subtasks.slice(0, 5) : [];
      res.json({ subtasks });
    } catch (error) {
      console.error("Error breaking down task:", error);
      res.status(500).json({ error: "Failed to break down task" });
    }
  });

  const coachTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "add_task",
        description: "Add a new task to the user's plan for today",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Task title" },
            category: { type: "string", enum: ["health", "work", "personal", "learning", "finance", "social"], description: "Task category" },
            duration: { type: "number", description: "Estimated duration in minutes" },
          },
          required: ["title", "category"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "add_to_brain_dump",
        description: "Add an item to the user's brain dump inbox",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "log_goal_progress",
        description: "Log progress toward a goal",
        parameters: {
          type: "object",
          properties: {
            goalTitle: { type: "string", description: "Partial or full goal title to match" },
            amount: { type: "number", description: "Amount to add to current progress" },
          },
          required: ["goalTitle", "amount"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_life_context",
        description: "Update one or more life context fields for the user",
        parameters: {
          type: "object",
          properties: {
            priorityGoal: { type: "string" },
            currentBlocker: { type: "string" },
            improvementArea: { type: "string" },
            upcomingDeadline: { type: "string" },
            freeText: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "complete_task",
        description: "Mark a task as complete in today's plan",
        parameters: {
          type: "object",
          properties: {
            taskTitle: { type: "string", description: "Partial or full title of the task to complete" },
          },
          required: ["taskTitle"],
        },
      },
    },
    ...(process.env.TAVILY_API_KEY ? [{
      type: "function" as const,
      function: {
        name: "web_search",
        description: "Search the internet for real-time information such as current events, weather, stock prices, news, product reviews, or anything else that requires up-to-date data. Use this when the user asks about something you don't know or when current information is needed.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query to look up" },
          },
          required: ["query"],
        },
      },
    }] : []),
    {
      type: "function" as const,
      function: {
        name: "check_connections",
        description: "Check which external accounts and channels the user has connected (Google/Gmail/Calendar, Microsoft/Outlook, Telegram, WhatsApp, Discord, Desktop Daemon). Always call this before claiming a service is or isn't available.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "generate_reconnect_link",
        description: "Generate a fresh OAuth authorization URL so the user can reconnect a disconnected Google or Microsoft account. Returns a tappable link button. Use after check_connections confirms the service is not connected.",
        parameters: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["google", "microsoft"], description: "Which provider to reconnect" },
          },
          required: ["provider"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "create_calendar_event",
        description: "Create a calendar event on the user's Google or Outlook calendar. Use when the user asks to schedule or block time. start and end must be ISO 8601 datetime strings.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Event title" },
            start: { type: "string", description: "Start datetime ISO 8601 (e.g. '2025-04-22T14:00:00Z')" },
            end: { type: "string", description: "End datetime ISO 8601 (e.g. '2025-04-22T15:00:00Z')" },
            description: { type: "string", description: "Optional event notes" },
            location: { type: "string", description: "Optional location or video link" },
            provider: { type: "string", enum: ["google", "microsoft"], description: "Calendar provider, default 'google'" },
          },
          required: ["title", "start", "end"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_calendar",
        description: "Fetch the user's Google Calendar events for a given day or date range. Use whenever the user asks about their schedule, meetings, availability, or what's coming up. Returns events with title, time, and location.",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "ISO date YYYY-MM-DD. Defaults to today if omitted." },
            days: { type: "number", description: "Number of consecutive days to fetch starting from date. Default 1, max 14." },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_emails",
        description: "Fetch recent emails on demand. Use when the user asks about their inbox beyond what's already in the system context. provider: 'google' (Gmail) or 'microsoft' (Outlook). count: number of emails to fetch (default 10, max 25).",
        parameters: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["google", "microsoft"], description: "Email provider" },
            count: { type: "number", description: "Number of emails to fetch (max 25)" },
          },
          required: ["provider"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "send_email",
        description: "Send an email immediately via Gmail or Outlook. Only use after the user explicitly confirms they want to send. Requires Google or Microsoft to be connected. If the user has multiple Google accounts, pass accountHint with the sender email address to select the correct account.",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject" },
            body: { type: "string", description: "Email body (plain text)" },
            provider: { type: "string", enum: ["google", "microsoft"], description: "Which provider to use, default 'google'" },
            accountHint: { type: "string", description: "Optional sender account email to disambiguate when multiple accounts are connected (e.g. 'alice@gmail.com')" },
          },
          required: ["to", "subject", "body"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "daemon_action",
        description: "Execute a sandboxed action on the user's paired daemon — either a desktop daemon or an Android device daemon. DESKTOP actions (when desktop daemon paired): shell, notify, file_read, file_write, file_list. ANDROID actions (when Android daemon paired): android_open_app (launch app by package name e.g. 'com.google.android.youtube'), android_browse (open URL in browser or app via deep link — for YouTube search use url='vnd.youtube://results?search_query=QUERY', for Google Maps use 'geo:0,0?q=QUERY', for Spotify use 'spotify:search:QUERY'), android_screenshot (capture screen), android_read_screen (read visible UI text), android_tap (tap at x/y), android_type (type text into focused field — set submit:true to also press Search/Go/Enter after typing), android_swipe (swipe gesture), android_press_key (back/home/recents/enter), android_file_list, android_file_read, android_notifications_list (read current phone notifications — checks server cache first; if cache is empty, AUTOMATICALLY swipes open the notification shade, reads the screen, then closes the shade; always returns real live data, never makes up notifications). CRITICAL RULES: (1) If this tool returns result:'error', STOP IMMEDIATELY and tell the user exactly what went wrong — do NOT proceed or pretend the action succeeded. (2) After android_open_app or android_browse succeeds, ALWAYS call android_read_screen next to confirm the screen state — NEVER describe app content or search results without first reading the screen. (3) For in-app searches (YouTube, Reddit, Maps, etc.) prefer android_browse with a deep link URL over open_app + navigate UI. Do NOT narrate what you plan to do before calling this tool — only confirm what actually happened after a successful result. Always call check_connections first to know which daemon type is paired.",
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["shell", "notify", "file_read", "file_write", "file_list", "android_open_app", "android_browse", "android_screenshot", "android_read_screen", "android_tap", "android_type", "android_swipe", "android_press_key", "android_file_list", "android_file_read", "android_notifications_list", "android_wait", "android_return_to_jarvis"], description: "Action to perform. 'notify' works on BOTH desktop and Android daemons — sends a pop-up banner notification with title and body. 'android_wait' pauses for ms milliseconds (default 1500, max 10000) — use between steps when the phone UI needs time to settle (e.g. after tapping a video to let it load before read_screen). 'android_return_to_jarvis' navigates the phone back to the Jarvis chat in the browser — call this as the LAST step of every multi-step task after the notify banner, to return the user to the conversation." },
            cmd: { type: "string", description: "Shell command (for 'shell' action)" },
            title: { type: "string", description: "Notification title (for 'notify' action)" },
            body: { type: "string", description: "Notification body (for 'notify' action)" },
            path: { type: "string", description: "File/directory path (for file_read/file_write/file_list/android_file_list/android_file_read)" },
            content: { type: "string", description: "File content (for file_write)" },
            packageName: { type: "string", description: "Android app package name (for android_open_app, e.g. 'com.google.android.youtube')" },
            url: { type: "string", description: "URL to open (for android_browse)" },
            x: { type: "number", description: "X pixel coordinate (for android_tap)" },
            y: { type: "number", description: "Y pixel coordinate (for android_tap)" },
            text: { type: "string", description: "Text to type (for android_type)" },
            submit: { type: "boolean", description: "If true, press IME Search/Go/Enter after typing (for android_type only)" },
            x1: { type: "number", description: "Swipe start X (for android_swipe)" },
            y1: { type: "number", description: "Swipe start Y (for android_swipe)" },
            x2: { type: "number", description: "Swipe end X (for android_swipe)" },
            y2: { type: "number", description: "Swipe end Y (for android_swipe)" },
            key: { type: "string", enum: ["back", "home", "recents", "volume_up", "volume_down", "enter"], description: "System key (for android_press_key). Use 'enter' to press IME Search/Go/Done/Enter on the keyboard." },
            limit: { type: "number", description: "Max notifications to return (for android_notifications_list, default 20)" },
            ms: { type: "number", description: "Milliseconds to wait (for android_wait, default 1500, max 10000). Use 1500–3000ms after tapping a video to let YouTube load." },
          },
          required: ["action"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "daemon_diagnostic",
        description: "Ping the paired daemon to verify it is alive and retrieve the recent op audit log (last 20 ops with timestamps and durations). Use this when: (1) an android_* op timed out or failed unexpectedly, (2) the user reports the daemon isn't responding, or (3) you want to check if the accessibility service is enabled on the device. Returns device state (model, androidVersion, accessibilityEnabled, foregroundPackage) and a timestamped log of recent ops.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "search_youtube",
        description: "Search YouTube server-side and return structured results with title, channel name, view count, published date, duration, and video ID — without touching the phone. Use this BEFORE opening a video so you can intelligently pick the best result (reputable channel, high views, recent date). Returns up to 10 results. Then use fetch_youtube_transcript to get the transcript of the chosen video, and android_browse to open it on the phone. Pass trending:true when the user asks for 'trending', 'viral', 'momentum', or 'views per hour' content — this sorts by views/hour instead of total views.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query, e.g. 'how to improve focus ADHD'" },
            maxResults: { type: "number", description: "Number of results to return (1-10, default 8)" },
            trending: { type: "boolean", description: "If true, sort by views-per-hour (velocity) instead of total views. Only use when user explicitly asks for trending/viral/momentum content." },
            daysBack: { type: "number", description: "Only include videos published within this many days (default 5). Used with trending:true." },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_youtube_transcript",
        description: "Fetch the COMPLETE transcript/captions of a YouTube video server-side — returns the full text with no truncation. Use this INSTEAD of navigating YouTube's transcript UI on the phone (never tap through 3-dot menus). Call it with the video ID after search_youtube or after reading the video ID from android_read_screen. The transcript can be long for lengthy videos — use it to answer questions, summarize content, or extract specific information.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (e.g. 'dQw4w9WgXcQ') or full YouTube URL (https://youtube.com/watch?v=dQw4w9WgXcQ). Extract the video ID from the URL visible on screen via android_read_screen." },
          },
          required: ["videoId"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "connect_channel",
        description: "Generate a one-tap deep link so the user can connect a new messaging channel (Telegram, WhatsApp, Slack, or Discord) to Jarvis. Returns a tappable link button. Use proactively when the user asks to connect/link any of these services.",
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: "string",
              enum: ["telegram", "whatsapp", "discord", "slack"],
              description: "Which channel to generate a connection link for.",
            },
          },
          required: ["channel"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "schedule_jarvis_task",
        description: "Schedule a future task for Jarvis to act on at a specific time. Use when the user says 'remind me to...', 'schedule...', 'do X at Y time', or asks Jarvis to take an action later. Always confirm the scheduled time before calling.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short title for the scheduled task (e.g. 'Review inbox', 'Send weekly update')" },
            description: { type: "string", description: "Optional details about what Jarvis should do when the time arrives" },
            scheduledAt: { type: "string", description: "ISO 8601 datetime when to execute the task (e.g. '2025-04-23T09:00:00Z')" },
            recurrence: { type: "string", description: "Optional recurrence pattern: 'daily', 'weekly', 'weekdays', 'every Monday', 'every Sunday', etc. Omit for one-time tasks." },
          },
          required: ["title", "scheduledAt"],
        },
      },
    },
  ];

  function fuzzyMatch(needle: string, haystack: string): boolean {
    const n = needle.toLowerCase().trim();
    const h = haystack.toLowerCase().trim();
    return h.includes(n) || n.includes(h);
  }

  const pendingConfirmations = new Map<string, { userId: string; tool: string; args: any; expiresAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of pendingConfirmations.entries()) {
      if (entry.expiresAt < now) pendingConfirmations.delete(token);
    }
  }, 60_000);

  async function executeCoachTool(
    toolName: string,
    args: any,
    userId: string
  ): Promise<{ result: 'success' | 'error'; label: string; detail: string }> {
    const todayKey = new Date().toISOString().slice(0, 10);
    try {
      switch (toolName) {
        case 'add_task': {
          const planResult = await db
            .select({ data: schema.plans.data })
            .from(schema.plans)
            .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, todayKey)));
          const plan: any = planResult.length > 0 ? planResult[0].data : { date: todayKey, tasks: [], greeting: '', insight: '' };
          const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
          const catMap: Record<string, string> = { health: 'fitness', work: 'career', learning: 'personal' };
          const category = catMap[args.category] || args.category || 'personal';
          const newTask = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            title: args.title,
            category,
            completed: false,
            priority: 'medium',
          };
          tasks.push(newTask);
          const updatedPlan = { ...plan, tasks };
          await db.insert(schema.plans)
            .values({ userId, date: todayKey, data: updatedPlan, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [schema.plans.userId, schema.plans.date],
              set: { data: updatedPlan, updatedAt: new Date() },
            });
          return { result: 'success', label: `Task added to today`, detail: `Added "${args.title}"` };
        }
        case 'add_to_brain_dump': {
          const bdResult = await db
            .select({ data: schema.brainDumpInbox.data })
            .from(schema.brainDumpInbox)
            .where(eq(schema.brainDumpInbox.userId, userId));
          const items: any[] = bdResult.length > 0 ? (Array.isArray(bdResult[0].data) ? bdResult[0].data : []) : [];
          items.unshift({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            text: args.text,
            createdAt: new Date().toISOString(),
          });
          await db.insert(schema.brainDumpInbox)
            .values({ userId, data: items, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [schema.brainDumpInbox.userId],
              set: { data: items, updatedAt: new Date() },
            });
          return { result: 'success', label: `Added to brain dump`, detail: `Added "${args.text}"` };
        }
        case 'log_goal_progress': {
          const goalsResult = await db
            .select({ data: schema.goals.data })
            .from(schema.goals)
            .where(eq(schema.goals.userId, userId));
          if (goalsResult.length === 0) return { result: 'error', label: 'No goals found', detail: 'User has no goals set' };
          const goalsList: any[] = Array.isArray(goalsResult[0].data) ? goalsResult[0].data : [];
          const matched = goalsList.find((g: any) => fuzzyMatch(args.goalTitle, g.title));
          if (!matched) return { result: 'error', label: `Goal not found`, detail: `Could not find goal matching "${args.goalTitle}"` };
          matched.current = (matched.current || 0) + args.amount;
          matched.updatedAt = new Date().toISOString();
          await db.insert(schema.goals)
            .values({ userId, data: goalsList, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [schema.goals.userId],
              set: { data: goalsList, updatedAt: new Date() },
            });
          return { result: 'success', label: `Progress logged`, detail: `Added ${args.amount} to "${matched.title}"` };
        }
        case 'update_life_context': {
          const lcResult = await db
            .select({ data: schema.lifeContext.data })
            .from(schema.lifeContext)
            .where(eq(schema.lifeContext.userId, userId));
          const existing: any = lcResult.length > 0 ? lcResult[0].data : {};
          const merged = { ...existing };
          if (args.priorityGoal) merged.priorityGoal = args.priorityGoal;
          if (args.currentBlocker) merged.currentBlocker = args.currentBlocker;
          if (args.improvementArea) merged.improvementArea = args.improvementArea;
          if (args.upcomingDeadline) merged.upcomingDeadline = args.upcomingDeadline;
          if (args.freeText) merged.freeText = args.freeText;
          merged.lastUpdated = new Date().toISOString();
          await db.insert(schema.lifeContext)
            .values({ userId, data: merged, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [schema.lifeContext.userId],
              set: { data: merged, updatedAt: new Date() },
            });
          const updatedFields = Object.keys(args).filter(k => args[k]).join(', ');
          return { result: 'success', label: `Context updated`, detail: `Updated: ${updatedFields}` };
        }
        case 'complete_task': {
          const planResult = await db
            .select({ data: schema.plans.data })
            .from(schema.plans)
            .where(and(eq(schema.plans.userId, userId), eq(schema.plans.date, todayKey)));
          if (planResult.length === 0) return { result: 'error', label: 'No plan today', detail: 'No plan found for today' };
          const plan: any = planResult[0].data;
          const tasks: any[] = Array.isArray(plan.tasks) ? plan.tasks : [];
          const matched = tasks.find((t: any) => !t.completed && fuzzyMatch(args.taskTitle, t.title));
          if (!matched) return { result: 'error', label: `Task not found`, detail: `Could not find incomplete task matching "${args.taskTitle}"` };
          matched.completed = true;
          const updatedPlan = { ...plan, tasks };
          await db.insert(schema.plans)
            .values({ userId, date: todayKey, data: updatedPlan, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [schema.plans.userId, schema.plans.date],
              set: { data: updatedPlan, updatedAt: new Date() },
            });
          // Phase 4 — extract memories opportunistically when a task is
          // completed. The completion text is a high-signal proxy for what
          // the user is actually working on; SOUL is marked stale so the
          // next coach turn rebuilds with the new fact.
          (async () => {
            try {
              const { extractAndStore } = await import("./memory/extractor");
              const { markSoulStale } = await import("./memory/soul");
              await extractAndStore({
                userId,
                source: `User just completed task: "${matched.title}". Notes: ${matched.notes || "(none)"}.`,
                sourceType: "plan_completion",
                sourceRef: `${todayKey}:${matched.title}`,
              });
              await markSoulStale(userId);
            } catch (extractErr) {
              console.error("[Phase4] plan-completion extract failed:", extractErr);
            }
          })();
          return { result: 'success', label: `Task completed`, detail: `Marked "${matched.title}" as done` };
        }
        case 'web_search': {
          try {
            const results = await tavilySearch(args.query);
            const formatted = formatSearchResults(results);
            return { result: 'success', label: `Web search: ${args.query}`, detail: formatted };
          } catch (searchErr: any) {
            const msg = String(searchErr?.message || searchErr);
            if (msg.includes('401') || msg.includes('403') || msg.includes('api_key')) {
              return { result: 'error', label: 'Search unavailable', detail: 'Web search API key is invalid or expired. Tell the user web search is currently unavailable.' };
            }
            if (msg.includes('429') || msg.includes('rate limit')) {
              return { result: 'error', label: 'Search rate limited', detail: 'Web search rate limit reached. Tell the user to try again in a moment.' };
            }
            if (msg.includes('timeout') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')) {
              return { result: 'error', label: 'Search timed out', detail: 'Web search timed out. Tell the user the search could not complete and suggest trying again.' };
            }
            return { result: 'error', label: 'Search failed', detail: `Web search failed: ${msg}. Tell the user you were unable to retrieve results.` };
          }
        }
        case 'check_connections': {
          const [googleToken, msToken, oauthStatus, tgRows, chRows] = await Promise.all([
            getValidGoogleToken(userId).catch(() => null),
            getValidMicrosoftToken(userId).catch(() => null),
            getUserOAuthStatus(userId).catch(() => ({} as Record<string, any>)),
            db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, userId)).limit(1),
            db.select().from(channelLinks).where(eq(channelLinks.userId, userId)),
          ]);
          const daemonOnline = isUserPaired(userId);
          const isAndroid = daemonOnline ? await isAndroidDaemonActive(userId) : false;
          const googleEmail = oauthStatus?.google?.email || (oauthStatus?.google?.accounts?.[0]?.email) || 'unknown';
          const msEmail = oauthStatus?.microsoft?.email || (oauthStatus?.microsoft?.accounts?.[0]?.email) || 'unknown';
          const slackConnectedCheck = (oauthStatus as any)?.slack?.connected ?? false;
          const daemonLabel = daemonOnline
            ? isAndroid
              ? `Android Device Daemon: ✓ online — use android_open_app, android_browse, android_screenshot, android_read_screen, android_tap, android_type, android_swipe, android_press_key, android_file_list, android_file_read, android_notifications_list, notify, android_return_to_jarvis. DO NOT use desktop shell/file actions. After completing a multi-step phone task: (1) call notify (title:'Jarvis ✓', body: one-line summary), then (2) call android_return_to_jarvis to navigate the phone back to the Jarvis chat. If a tool returns result:error, stop and report the error immediately — do NOT fabricate success. After android_open_app or android_browse succeeds, ALWAYS call android_read_screen before describing screen content. For app searches use deep links: YouTube='vnd.youtube://results?search_query=QUERY', Maps='geo:0,0?q=QUERY', Spotify='spotify:search:QUERY'.`
              : `Desktop Daemon: ✓ online — use shell, notify, file_read, file_write, file_list actions.`
            : `Android/Desktop Daemon: ✗ not connected — user must open Jarvis app → Profile → Android Device → Get Pairing Code, then open the Jarvis Daemon APK, enter server URL https://GameplanAI.replit.app and the 8-character code, tap Pair`;
          const lines = [
            `Google (Gmail + Calendar): ${googleToken ? `✓ token valid — ${googleEmail}` : '✗ not connected or token expired (reconnect needed)'}`,
            `Microsoft (Outlook + Calendar): ${msToken ? `✓ token valid — ${msEmail}` : '✗ not connected or token expired (reconnect needed)'}`,
            `Slack: ${slackConnectedCheck ? '✓ connected' : '✗ not connected'}`,
            `Telegram: ${tgRows.length > 0 ? '✓ linked' : '✗ not linked'}`,
            `WhatsApp: ${chRows.some((r: any) => r.channel === 'whatsapp') ? '✓ linked' : '✗ not linked'}`,
            `Discord: ${chRows.some((r: any) => r.channel === 'discord') ? '✓ linked' : '✗ not linked'}`,
            daemonLabel,
          ];
          return { result: 'success', label: 'Connection status checked', detail: lines.join('\n') };
        }
        case 'generate_reconnect_link': {
          const provider = String(args.provider || '').toLowerCase();
          const domain = process.env.REPLIT_DOMAINS?.split(',')[0];
          const isDev = process.env.REPLIT_DEV_DOMAIN === domain;
          const baseUrl = domain ? (isDev ? `https://${domain}:5000` : `https://${domain}`) : 'http://localhost:5000';
          if (provider === 'google') {
            const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
            if (!clientId) return { result: 'error', label: 'Google not configured', detail: 'Google OAuth client ID not set on server.' };
            const params = new URLSearchParams({
              client_id: clientId,
              redirect_uri: `${baseUrl}/api/oauth/google/callback`,
              response_type: 'code',
              scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive.file',
              access_type: 'offline',
              prompt: 'consent',
              state: userId,
            });
            const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
            return { result: 'success', label: 'Reconnect Google', detail: JSON.stringify({ url, buttonLabel: 'Reconnect Google', provider: 'google' }) };
          }
          if (provider === 'microsoft') {
            const clientId = process.env.MICROSOFT_CLIENT_ID;
            if (!clientId) return { result: 'error', label: 'Microsoft not configured', detail: 'Microsoft OAuth client ID not set on server.' };
            const params = new URLSearchParams({
              client_id: clientId,
              redirect_uri: `${baseUrl}/api/oauth/microsoft/callback`,
              response_type: 'code',
              scope: 'offline_access Calendars.ReadWrite Mail.ReadWrite Mail.Send User.Read',
              state: userId,
              response_mode: 'query',
            });
            const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
            return { result: 'success', label: 'Reconnect Outlook', detail: JSON.stringify({ url, buttonLabel: 'Reconnect Outlook', provider: 'microsoft' }) };
          }
          return { result: 'error', label: 'Unknown provider', detail: `Unknown provider: ${provider}` };
        }
        case 'create_calendar_event': {
          const title = String(args.title || '').trim();
          const start = String(args.start || '').trim();
          const end = String(args.end || '').trim();
          const description = args.description ? String(args.description).trim() : undefined;
          const location = args.location ? String(args.location).trim() : undefined;
          const provider = (String(args.provider || 'google')).toLowerCase();
          if (!title || !start || !end) return { result: 'error', label: 'Missing fields', detail: 'title, start, and end are required.' };
          if (provider === 'google') {
            const tokens = await getValidGoogleTokens(userId);
            if (!tokens.length) return { result: 'error', label: 'Google not connected', detail: 'Connect Google in Profile to create calendar events.' };
            const result = await createGoogleCalendarEvent(tokens[0], { title, start, end, description, location });
            return { result: 'success', label: `Event created: ${title}`, detail: result.htmlLink || `Created on ${start.slice(0, 10)}` };
          }
          if (provider === 'microsoft') {
            const msToken = await getValidMicrosoftToken(userId);
            if (!msToken) return { result: 'error', label: 'Microsoft not connected', detail: 'Connect Microsoft in Profile to create Outlook calendar events.' };
            await createOutlookCalendarEvent(msToken, { title, start, end, description, location });
            return { result: 'success', label: `Event created: ${title}`, detail: `Created on ${start.slice(0, 10)}` };
          }
          return { result: 'error', label: 'Unknown provider', detail: `Unknown provider: ${provider}` };
        }
        case 'fetch_calendar': {
          const tokens = await getValidGoogleTokens(userId);
          if (!tokens.length) return { result: 'error', label: 'Google not connected', detail: 'Connect Google in Profile to fetch calendar events.' };
          const startDate = String(args.date || new Date().toISOString().slice(0, 10));
          const days = Math.min(Math.max(Number(args.days) || 1, 1), 14);
          function addDaysLocal(dateStr: string, n: number): string {
            const d = new Date(dateStr + 'T12:00:00Z');
            d.setUTCDate(d.getUTCDate() + n);
            return d.toISOString().slice(0, 10);
          }
          const blocks: string[] = [];
          let totalEvents = 0;
          for (let i = 0; i < days; i++) {
            const d = addDaysLocal(startDate, i);
            const events = await getGoogleCalendarEvents(d, undefined, undefined, tokens[0]);
            totalEvents += events.length;
            if (events.length === 0) {
              blocks.push(`${d}: (no events)`);
              continue;
            }
            const lines = events.map((e: any) => {
              const loc = e.location ? ` @ ${e.location}` : '';
              return `  - ${e.time || e.start || ''}${e.end ? `–${e.end}` : ''}: ${e.title || '(no title)'}${loc}`;
            });
            blocks.push(`${d}:\n${lines.join('\n')}`);
          }
          return { result: 'success', label: `Calendar: ${totalEvents} event(s) over ${days} day(s)`, detail: blocks.join('\n\n') };
        }
        case 'fetch_emails': {
          const provider = (String(args.provider || 'google')).toLowerCase();
          const count = Math.min(Number(args.count) || 10, 25);
          if (provider === 'google') {
            const tokens = await getValidGoogleTokens(userId);
            if (!tokens.length) return { result: 'error', label: 'Gmail not connected', detail: 'Connect Google in Profile to fetch emails.' };
            const emails = await getRecentEmailCommitments(14, tokens[0]);
            const recent = emails.slice(0, count).map((e: any) => `- From: ${e.from || 'unknown'} | "${e.subject}" — ${e.snippet}`).join('\n');
            return { result: 'success', label: `Fetched ${Math.min(emails.length, count)} Gmail emails`, detail: recent || 'No emails found.' };
          }
          if (provider === 'microsoft') {
            const msToken = await getValidMicrosoftToken(userId);
            if (!msToken) return { result: 'error', label: 'Outlook not connected', detail: 'Connect Microsoft in Profile to fetch emails.' };
            const emails = await getRecentOutlookEmails(msToken, count);
            const text = emails.map((e: any) => `- From: ${e.from} | "${e.subject}" — ${e.snippet}`).join('\n');
            return { result: 'success', label: `Fetched ${emails.length} Outlook emails`, detail: text || 'No emails found.' };
          }
          return { result: 'error', label: 'Unknown provider', detail: `Unknown provider: ${provider}` };
        }
        case 'send_email': {
          const to = String(args.to || '').trim();
          const subject = String(args.subject || '').trim();
          const body = String(args.body || '');
          const provider = (String(args.provider || 'google')).toLowerCase();
          const accountHint = args.accountHint ? String(args.accountHint).trim().toLowerCase() : null;
          if (!to || !subject || !body.trim()) return { result: 'error', label: 'Missing fields', detail: 'to, subject, and body are all required.' };
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(to)) return { result: 'error', label: 'Invalid recipient', detail: `"${to}" is not a valid email address.` };
          if (provider === 'google') {
            let token: string | null = null;
            if (accountHint) {
              const allTokens = await getUserTokens(userId, 'google');
              const match = allTokens.find(t => (t.accountEmail || '').toLowerCase() === accountHint);
              if (match) {
                if (match.expiresAt && match.expiresAt.getTime() < Date.now() + 60_000) {
                  token = (await getValidGoogleToken(userId));
                } else {
                  token = match.accessToken;
                }
              }
            }
            if (!token) token = await getValidGoogleToken(userId);
            if (!token) return { result: 'error', label: 'Gmail not connected', detail: 'Connect Google in Profile to send emails.' };
            const result = await sendGmailEmail(token, to, subject, body);
            return { result: 'success', label: `Email sent to ${to}`, detail: `Gmail message ID: ${result.messageId}` };
          }
          if (provider === 'microsoft') {
            const msToken = await getValidMicrosoftToken(userId);
            if (!msToken) return { result: 'error', label: 'Outlook not connected', detail: 'Connect Microsoft in Profile to send emails.' };
            await sendOutlookEmail(msToken, to, subject, body);
            return { result: 'success', label: `Email sent to ${to}`, detail: `Sent via Outlook` };
          }
          return { result: 'error', label: 'Unknown provider', detail: `Unknown provider: ${provider}` };
        }
        case 'daemon_action': {
          const action = String(args.action || '');
          if (!isUserPaired(userId)) {
            return { result: 'error', label: 'Daemon not connected', detail: 'No daemon paired. Install and pair either the desktop daemon or the Android APK from Profile → Connected Channels.' };
          }
          const isAndroidDaemon = await isAndroidDaemonActive(userId);
          const androidActions = ['android_open_app', 'android_browse', 'android_return_to_jarvis', 'android_screenshot', 'android_read_screen', 'android_tap', 'android_type', 'android_swipe', 'android_press_key', 'android_file_list', 'android_file_read', 'android_notifications_list', 'android_wait', 'notify'];
          const desktopActions = ['shell', 'notify', 'file_read', 'file_write', 'file_list'];

          let op: DaemonOp;
          if (androidActions.includes(action)) {
            if (!isAndroidDaemon) return { result: 'error', label: 'Android daemon required', detail: 'This action requires an Android daemon. The paired daemon is a desktop daemon.' };
            // Check Android permissions
            const permMap: Record<string, AndroidDaemonAction | null> = {
              android_screenshot: 'android_screenshot', android_read_screen: 'android_read_screen',
              android_open_app: 'android_open_app', android_browse: 'android_browse',
              android_file_list: 'android_file_list', android_file_read: 'android_file_read',
              android_tap: 'android_tap_type', android_type: 'android_tap_type',
              android_swipe: 'android_tap_type', android_press_key: 'android_tap_type',
              android_notifications_list: null,  // served from server cache — no daemon permission needed
            };
            const permKey = permMap[action];
            if (permKey && !(await isAndroidDaemonActionAllowed(userId, permKey))) {
              return { result: 'error', label: `Permission denied`, detail: `Android action '${action}' is not permitted. Enable it in Profile → Connected Channels → Android Device → Permissions.` };
            }
            if (action === 'android_open_app') {
              if (!args.packageName) return { result: 'error', label: 'packageName required', detail: 'Provide packageName for android_open_app.' };
              op = { type: 'android_open_app', packageName: String(args.packageName) };
            } else if (action === 'android_browse') {
              if (!args.url) return { result: 'error', label: 'url required', detail: 'Provide url for android_browse.' };
              let browseUrl = String(args.url);
              // Normalize well-known URLs → native app deep links so the app (not the browser) opens
              const ytSearch = browseUrl.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/results\?search_query=([^&]+)/);
              if (ytSearch) browseUrl = `vnd.youtube://results?search_query=${ytSearch[1]}`;
              const ytWatch = browseUrl.match(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]+)/);
              if (ytWatch) browseUrl = `vnd.youtube://watch?v=${ytWatch[1]}`;
              op = { type: 'android_browse', url: browseUrl };
            } else if (action === 'android_return_to_jarvis') {
              op = { type: 'android_return_to_jarvis' };
            } else if (action === 'android_screenshot') {
              op = { type: 'android_screenshot' };
            } else if (action === 'android_read_screen') {
              op = { type: 'android_read_screen' };
            } else if (action === 'android_tap') {
              if (typeof args.x !== 'number' || typeof args.y !== 'number') return { result: 'error', label: 'x,y required', detail: 'Provide x and y for android_tap.' };
              op = { type: 'android_tap', x: args.x, y: args.y };
            } else if (action === 'android_type') {
              if (!args.text) return { result: 'error', label: 'text required', detail: 'Provide text for android_type.' };
              op = { type: 'android_type', text: String(args.text), submit: !!args.submit };
            } else if (action === 'android_notifications_list') {
              const limit = typeof args.limit === 'number' ? Math.min(args.limit, 60) : 20;

              // ── Path 1: Query the daemon's own on-device notification cache ──
              // The daemon's JarvisNotificationListener accumulates every notification
              // that arrives while the daemon app is running, stored in memory on the phone.
              // This persists across server restarts — unlike the server-side cache which
              // is empty after every server restart. Always go here first.
              const daemonNotifResult = await sendDaemonOp(userId, { type: 'android_notifications_list', limit } as DaemonOp, 10000);

              if (daemonNotifResult.ok) {
                const d = daemonNotifResult.data as Record<string, unknown> | null;
                const listenerEnabled = !!(d?.listenerEnabled);
                const rawNotifications = Array.isArray(d?.notifications) ? (d!.notifications as Record<string, unknown>[]) : [];
                const count = rawNotifications.length;

                if (listenerEnabled && count > 0) {
                  const relativeTime = (tsMs: number): string => {
                    const diffMs = Date.now() - tsMs;
                    const diffMins = Math.round(diffMs / 60000);
                    if (diffMins < 1) return 'just now';
                    if (diffMins < 60) return `${diffMins}m ago`;
                    const diffHours = Math.floor(diffMins / 60);
                    if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
                    return `${Math.floor(diffHours / 24)}d ago`;
                  };
                  const formatted = rawNotifications.map((n) => {
                    const ago = typeof n.ts === 'number' ? relativeTime(n.ts) : '?';
                    const app = String(n.app || n.pkg || 'Unknown');
                    const title = String(n.title || '');
                    const text = n.text ? `: ${String(n.text).slice(0, 120)}` : '';
                    return `• ${app} (${ago}) — ${title}${text}`;
                  }).join('\n');
                  return {
                    result: 'success',
                    label: `${count} notification${count !== 1 ? 's' : ''} from phone`,
                    detail: `PHONE NOTIFICATIONS (${count} total) — speak these back to the user exactly. The "(X ago)" values are relative ages; DO NOT convert them to clock times — you cannot know the user's timezone and any conversion will be wrong. Just say "X minutes ago" or "X hours ago" as shown.\n\n${formatted}`,
                  };
                }

                if (listenerEnabled && count === 0) {
                  // Listener is active but no notifications — this IS accurate data
                  return {
                    result: 'success',
                    label: 'No notifications',
                    detail: 'The notification listener is active on the phone and reports zero current notifications. The tray is clear.',
                  };
                }

                // listenerEnabled=false → Notification Access not granted on the phone
                console.warn(`[daemon] android_notifications_list: listenerEnabled=false for userId=${userId}, falling back to shade`);
              } else {
                console.warn(`[daemon] android_notifications_list direct op failed (${daemonNotifResult.error}), falling back to shade`);
              }

              // ── Path 2: Notification Access not granted OR daemon query failed ──
              // Physically open the notification shade, read the screen, then close it.
              const swipeOp = await sendDaemonOp(userId, {
                type: 'android_swipe',
                x1: 540, y1: 10,
                x2: 540, y2: 1200,
                durationMs: 400,
              }, 8000);

              if (!swipeOp.ok) {
                return {
                  result: 'error',
                  label: 'Cannot read notifications',
                  detail: `The Notification Access permission is not granted to Jarvis Daemon (go to Settings > Notifications > Device & App Notifications > Jarvis Daemon and enable it). The shade-opening fallback also failed: ${swipeOp.error || 'swipe failed'}.`,
                };
              }

              // Wait for the shade animation
              await new Promise(r => setTimeout(r, 700));

              const shadeReadOp = await sendDaemonOp(userId, { type: 'android_read_screen' }, 10000);

              // Close the shade in the background
              sendDaemonOp(userId, { type: 'android_press_key', key: 'back' }, 5000).catch(() => {});

              if (!shadeReadOp.ok) {
                return {
                  result: 'error',
                  label: 'Could not read notification shade',
                  detail: `Screen read failed: ${shadeReadOp.error || 'unknown'}. Ensure the Accessibility Service is enabled.`,
                };
              }

              // The read_screen result is a structured JSON object from the accessibility tree.
              // Extract the text fields and return them verbatim.
              const shadeData = shadeReadOp.data;
              const shadeText = typeof shadeData === 'string'
                ? shadeData
                : JSON.stringify(shadeData || '');

              if (!shadeText || shadeText === '{}' || shadeText === '""' || shadeText === 'null') {
                return {
                  result: 'success',
                  label: 'Notification shade appears empty',
                  detail: 'No text was detected in the notification shade. Your notification tray may be empty.',
                };
              }

              return {
                result: 'success',
                label: 'Notification shade content read from screen',
                detail: `SCREEN CONTENT (verbatim from phone — report ONLY what is shown here, do NOT add or infer any details):\n${shadeText}`,
              };
            } else if (action === 'android_wait') {
              // Server-side pause — no daemon op needed. Lets the phone UI settle between steps.
              const ms = Math.min(Math.max(typeof args.ms === 'number' ? args.ms : 1500, 200), 10000);
              await new Promise(resolve => setTimeout(resolve, ms));
              return { result: 'success', label: `Waited ${ms}ms`, detail: `Paused ${ms}ms to let the phone UI settle.` };
            } else if (action === 'android_swipe') {
              if (typeof args.x1 !== 'number' || typeof args.y1 !== 'number' || typeof args.x2 !== 'number' || typeof args.y2 !== 'number') return { result: 'error', label: 'coords required', detail: 'Provide x1,y1,x2,y2 for android_swipe.' };
              op = { type: 'android_swipe', x1: args.x1, y1: args.y1, x2: args.x2, y2: args.y2, durationMs: typeof args.durationMs === 'number' ? args.durationMs : 300 };
            } else if (action === 'android_press_key') {
              const validKeys = ['back', 'home', 'recents', 'volume_up', 'volume_down', 'enter'] as const;
              const key = String(args.key || 'back') as typeof validKeys[number];
              if (!validKeys.includes(key)) return { result: 'error', label: 'invalid key', detail: 'Key must be back, home, recents, volume_up, volume_down, or enter.' };
              op = { type: 'android_press_key', key };
            } else if (action === 'android_file_list') {
              if (!args.path) return { result: 'error', label: 'path required', detail: 'Provide path for android_file_list.' };
              op = { type: 'android_file_list', path: String(args.path) };
            } else if (action === 'notify') {
              op = { type: 'notify', title: String(args.title || 'Jarvis'), body: String(args.body || '') };
            } else {
              if (!args.path) return { result: 'error', label: 'path required', detail: 'Provide path for android_file_read.' };
              op = { type: 'android_file_read', path: String(args.path) };
            }
          } else if (desktopActions.includes(action)) {
            if (isAndroidDaemon) return { result: 'error', label: 'Wrong daemon type', detail: `Action '${action}' is desktop-only. Use android_* actions for the connected Android daemon.` };
            if (!(await isDaemonActionAllowed(userId, action as DaemonAction))) {
              return { result: 'error', label: `Action '${action}' not permitted`, detail: `Enable '${action}' in Profile → Connected Channels → Desktop Daemon → Permissions.` };
            }
            if (action === 'shell') {
              if (!args.cmd) return { result: 'error', label: 'cmd required', detail: 'Provide cmd for shell action.' };
              op = { type: 'shell', cmd: String(args.cmd), cwd: args.cwd ? String(args.cwd) : undefined };
            } else if (action === 'notify') {
              op = { type: 'notify', title: String(args.title || 'Jarvis'), body: String(args.body || '') };
            } else if (action === 'file_read') {
              if (!args.path) return { result: 'error', label: 'path required', detail: 'Provide path for file_read.' };
              op = { type: 'file_read', path: String(args.path) };
            } else if (action === 'file_write') {
              if (!args.path || typeof args.content !== 'string') return { result: 'error', label: 'path+content required', detail: 'Provide path and content for file_write.' };
              op = { type: 'file_write', path: String(args.path), content: String(args.content) };
            } else {
              if (!args.path) return { result: 'error', label: 'path required', detail: 'Provide path for file_list.' };
              op = { type: 'file_list', path: String(args.path) };
            }
          } else {
            return { result: 'error', label: 'Unknown action', detail: `Unknown daemon action: ${action}` };
          }
          // Auto-preflight: for every android_* op (except android_notifications_list which
          // is served from the server cache), run a 5s ping first. This causes the op to
          // fail fast (<5s) if the daemon is stale or the accessibility service has crashed,
          // rather than waiting the full 30s op timeout on a silent failure.
          if (action.startsWith('android_') && action !== 'android_notifications_list') {
            const preflightResult = await pingDaemon(userId, 5000);
            if (!preflightResult.ok) {
              return {
                result: 'error',
                label: '⛔ Daemon is not responding',
                detail: `Daemon ping failed before '${action}' (${preflightResult.error}). The daemon is not responding — it may have been killed by Samsung battery optimisation, the accessibility service may have been disabled, or the phone may be locked. Tell the user: "The Jarvis Daemon isn't responding. Please open the Jarvis Daemon app on your phone to check the status dot and the Recent Activity log — if the accessibility service is disabled, tap Fix to re-enable it."`,
              };
            }
          }

          // Use tight per-action timeouts so a hung op fails fast
          // instead of blocking the 30s default (which pushes total chat time over 60s).
          const actionTimeouts: Record<string, number> = {
            android_read_screen: 8000,
            android_tap: 6000,
            android_swipe: 6000,
            android_press_key: 5000,
            android_type: 10000,
            android_browse: 8000,
            android_return_to_jarvis: 10000,
            android_open_app: 15000,
            android_screenshot: 20000,
            android_notifications_list: 12000,
            android_file_list: 8000,
            android_file_read: 10000,
            shell: 20000,
            notify: 5000,
            file_read: 10000,
            file_write: 10000,
            file_list: 8000,
          };
          const timeoutMs = actionTimeouts[action] ?? 12000;
          const daemonResult = await sendDaemonOp(userId, op, timeoutMs);
          if (!daemonResult.ok) return { result: 'error', label: 'Daemon action failed', detail: daemonResult.error || 'Unknown error' };

          // Handle screenshot specially: store the image and return a URL instead of raw base64
          if (action === 'android_screenshot' && daemonResult.data) {
            const data = daemonResult.data as Record<string, unknown>;
            const b64 = data.screenshot as string | undefined;
            if (b64 && b64.length > 0) {
              const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
              const buf = Buffer.from(b64, 'base64');
              screenshotStore.set(id, { data: buf, expires: Date.now() + 30 * 60 * 1000 });
              return { result: 'success', label: 'Screenshot captured', detail: JSON.stringify({ screenshotUrl: `/api/daemon/screenshot/${id}` }) };
            }
          }

          return { result: 'success', label: `Daemon: ${action}`, detail: JSON.stringify(daemonResult.data || {}).slice(0, 2000) };
        }
        case 'daemon_diagnostic': {
          if (!isUserPaired(userId)) {
            return { result: 'error', label: 'Daemon not connected', detail: 'No daemon paired — cannot run diagnostic.' };
          }
          const pingResult = await pingDaemon(userId, 5000);
          const auditEntries = getOpAuditLog(userId);
          const recent = auditEntries.slice(-20).reverse();
          const recentStr = recent.length === 0 ? 'No ops recorded yet.' : recent.map((e) => {
            const d = new Date(e.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return `[${d}] ${e.type} → ${e.ok ? 'OK' : `FAIL: ${e.error}`} (${e.durationMs}ms)`;
          }).join('\n');
          const pingStr = pingResult.ok
            ? `ping OK — ${JSON.stringify(pingResult.data)}`
            : `ping FAILED — ${pingResult.error}`;
          return {
            result: pingResult.ok ? 'success' : 'error',
            label: pingResult.ok ? 'Daemon alive' : 'Daemon ping failed',
            detail: `${pingStr}\n\nRecent op log (newest first):\n${recentStr}`,
          };
        }
        case 'search_youtube': {
          const query = String(args.query || '').trim();
          if (!query) return { result: 'error', label: 'query required', detail: 'Provide a search query.' };
          const maxResults = Math.min(Math.max(typeof args.maxResults === 'number' ? args.maxResults : 8, 1), 10);
          const trendingMode = !!args.trending;
          const daysBack = typeof args.daysBack === 'number' ? args.daysBack : 5;
          try {
            const searchResult = await ytSearch({ query, pageStart: 1, pageEnd: 1 });
            let videos = (searchResult.videos || []) as any[];

            if (trendingMode) {
              // Compute views-per-hour for each video and sort by velocity
              const now = Date.now();
              const daysMs = daysBack * 24 * 60 * 60 * 1000;
              videos = videos
                .map((v: any) => {
                  const viewCount = typeof v.views === 'number' ? v.views : parseInt(String(v.views).replace(/[^0-9]/g, ''), 10) || 0;
                  // Parse "X days ago", "X hours ago", etc. from v.ago
                  let ageMs = daysBack * 24 * 60 * 60 * 1000; // fallback
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

              if (videos.length === 0) return { result: 'error', label: 'No trending results', detail: `No videos found in the last ${daysBack} days for: "${query}"` };

              const formatted = videos.map((v: any, i: number) => {
                const views = v.viewCount.toLocaleString();
                const vph = v.viewsPerHour.toLocaleString();
                const ago = v.ago || 'unknown date';
                return `${i + 1}. "${v.title}"\n   Channel: ${v.author?.name || 'unknown'}\n   Views/hr: ${vph} | Total: ${views} | Posted: ${ago}\n   Video ID: ${v.videoId}\n   URL: ${v.url}`;
              }).join('\n\n');

              return {
                result: 'success',
                label: `YouTube trending: ${videos.length} results`,
                detail: `Trending search (views/hour): "${query}" — last ${daysBack} days\n\n${formatted}`,
              };
            }

            // Standard mode
            videos = videos.slice(0, maxResults);
            if (videos.length === 0) return { result: 'error', label: 'No results', detail: `No YouTube videos found for: "${query}"` };
            const formatted = videos.map((v: any, i: number) => {
              const views = typeof v.views === 'number' ? v.views.toLocaleString() : (v.views || 'unknown');
              const ago = v.ago || 'unknown date';
              const duration = v.duration?.timestamp || v.duration || 'unknown';
              return `${i + 1}. "${v.title}"\n   Channel: ${v.author?.name || 'unknown'}\n   Views: ${views} | Posted: ${ago} | Duration: ${duration}\n   Video ID: ${v.videoId}\n   URL: ${v.url}`;
            }).join('\n\n');
            return {
              result: 'success',
              label: `YouTube search: ${videos.length} results`,
              detail: `Search: "${query}"\n\n${formatted}\n\nTo open a video on the phone: android_browse with url='vnd.youtube://watch?v=VIDEO_ID'\nTo get its transcript: fetch_youtube_transcript with videoId='VIDEO_ID'`,
            };
          } catch (err: any) {
            return { result: 'error', label: 'YouTube search failed', detail: err?.message || String(err) };
          }
        }
        case 'fetch_youtube_transcript': {
          const rawInput = String(args.videoId || '').trim();
          if (!rawInput) return { result: 'error', label: 'videoId required', detail: 'Provide a YouTube video ID or URL.' };
          // Extract ID from URL if a full URL was given
          let videoId = rawInput;
          const urlMatch = rawInput.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          if (urlMatch) videoId = urlMatch[1];
          // Also handle bare IDs that may include URL params
          const idMatch = videoId.match(/^([a-zA-Z0-9_-]{11})/);
          if (idMatch) videoId = idMatch[1];
          try {
            const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
            if (!transcriptItems || transcriptItems.length === 0) {
              return { result: 'error', label: 'No transcript available', detail: `The video '${videoId}' does not have a transcript/captions enabled. This is common for music videos or videos where the creator disabled captions.` };
            }
            const fullText = transcriptItems.map(t => t.text).join(' ').replace(/\s+/g, ' ').trim();
            return { result: 'success', label: 'Transcript fetched', detail: `Video ID: ${videoId}\nTranscript (${transcriptItems.length} segments, ${fullText.length} chars total):\n\n${fullText}` };
          } catch (err: any) {
            const msg = err?.message || String(err);
            if (msg.includes('disabled') || msg.includes('Transcript is disabled')) {
              return { result: 'error', label: 'Transcript disabled', detail: `Transcripts are disabled for video '${videoId}'. Try a different video.` };
            }
            return { result: 'error', label: 'Transcript fetch failed', detail: msg };
          }
        }
        case 'connect_channel': {
          const toolResult = await connectChannelTool.execute(args, { userId, state: {} });
          if (!toolResult.ok) {
            return { result: 'error', label: toolResult.label || 'Connection failed', detail: toolResult.content };
          }
          return { result: 'success', label: toolResult.label || 'Connect channel', detail: toolResult.detail || toolResult.content };
        }
        case 'schedule_jarvis_task': {
          if (!args.title || !args.scheduledAt) {
            return { result: 'error', label: 'Missing required fields', detail: 'title and scheduledAt are required' };
          }
          const scheduledDate = new Date(args.scheduledAt);
          if (isNaN(scheduledDate.getTime())) {
            return { result: 'error', label: 'Invalid date', detail: `scheduledAt "${args.scheduledAt}" is not a valid ISO 8601 datetime` };
          }
          await db.insert(schema.jarvisScheduledTasks).values({
            userId,
            title: String(args.title),
            description: args.description ? String(args.description) : null,
            scheduledAt: scheduledDate,
            recurrence: args.recurrence ? String(args.recurrence) : null,
          });
          const timeLabel = scheduledDate.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          const recurrenceLabel = args.recurrence ? ` (${args.recurrence})` : '';
          return { result: 'success', label: 'Task scheduled', detail: `"${args.title}" scheduled for ${timeLabel}${recurrenceLabel}` };
        }
        default:
          return { result: 'error', label: 'Unknown action', detail: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);
      return { result: 'error', label: 'Action failed', detail: String(error) };
    }
  }

  function normalizeMemoryContent(content: string): string {
    return content.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
  }

  async function extractProfileInBackground(userId: string, messages: any[]) {
    const recentMessages = messages.slice(-6);
    if (recentMessages.length === 0) return;
    const conversationText = recentMessages
      .map((m: any) => `${m.role}: ${m.content}`)
      .join('\n');
    await extractAndStore({
      userId,
      source: conversationText,
      sourceType: "chat",
    });
  }

  async function markProactiveQuestionsAnswered(userId: string, messages: any[]) {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const unanswered = await db.select()
        .from(proactiveQuestionsSent)
        .where(
          and(
            eq(proactiveQuestionsSent.userId, userId),
            sql`${proactiveQuestionsSent.answeredAt} IS NULL`,
            sql`${proactiveQuestionsSent.sentAt} > ${twentyFourHoursAgo}`
          )
        )
        .orderBy(desc(proactiveQuestionsSent.sentAt))
        .limit(1);
      if (unanswered.length > 0) {
        const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
        if (!lastUserMessage?.content) return;

        const checkResponse = await openai.chat.completions.create({
          model: "gpt-5-mini",
          messages: [{
            role: "user",
            content: `Is the following user message a reply to (or related to) this question? Only answer "yes" or "no".

Question that was asked: "${unanswered[0].question}"
User's message: "${lastUserMessage.content}"

Answer (yes/no):`,
          }],
          max_completion_tokens: 10,
        });
        const answer = (checkResponse.choices[0]?.message?.content || '').trim().toLowerCase();
        if (answer.startsWith('yes')) {
          await db.update(proactiveQuestionsSent)
            .set({ answeredAt: new Date() })
            .where(eq(proactiveQuestionsSent.id, unanswered[0].id));
          console.log(`[Profile] Marked proactive question as answered via coach chat: ${unanswered[0].id}`);
        }
      }
    } catch (err) {
      console.error("[Profile] Error marking proactive question answered:", err);
    }
  }

  app.post("/api/coach/chat", async (req: Request, res: Response) => {
    try {
      const { messages, goals, stats, history, calendarEvents, lifeContext, gmailItems, gmailConnected, slackMessages, slackConnected, coachingMode, telegramMessages, telegramConnected } = req.body;
      const userId = req.userId;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "messages array is required" });
      }

      let resolvedGmailConnected = gmailConnected ?? false;
      let resolvedGmailItems = gmailItems || [];

      if (!resolvedGmailConnected && userId) {
        try {
          const userTokens = await getUserTokens(userId, 'google');
          if (userTokens.length > 0) {
            resolvedGmailConnected = true;
            const perAccountItems = await Promise.all(
              userTokens.map(async (t) => {
                const emails = await getRecentEmailCommitments(7, t.accessToken).catch(() => []);
                return emails.map((e: any) => ({ ...e, accountEmail: t.accountEmail }));
              })
            );
            resolvedGmailItems = perAccountItems.flat();
          }
        } catch {}
      }

      let userCommitments: any[] = [];
      if (userId) {
        try {
          userCommitments = await db
            .select()
            .from(schema.commitments)
            .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
            .orderBy(desc(schema.commitments.extractedAt))
            .limit(20);
        } catch {}
      }

      let memories: { content: string; category: string }[] = [];
      let morningNoteSummary = '';
      let documentsContext = '';
      if (userId) {
        try {
          const [rows, noteSummary, docsCtx] = await Promise.all([
            db.select({ content: userMemories.content, category: userMemories.category })
              .from(userMemories)
              .where(eq(userMemories.userId, userId))
              .orderBy(desc(userMemories.extractedAt))
              .limit(50),
            getMorningNoteSummary(userId),
            getUserDocumentContext(userId),
          ]);
          memories = rows;
          morningNoteSummary = noteSummary;
          documentsContext = docsCtx;
        } catch {}
      }

      let proactiveQuestionContext = '';
      if (userId) {
        try {
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const recentUnanswered = await db.select()
            .from(proactiveQuestionsSent)
            .where(
              and(
                eq(proactiveQuestionsSent.userId, userId),
                sql`${proactiveQuestionsSent.answeredAt} IS NULL`,
                sql`${proactiveQuestionsSent.sentAt} > ${twentyFourHoursAgo}`
              )
            )
            .orderBy(desc(proactiveQuestionsSent.sentAt))
            .limit(3);
          if (recentUnanswered.length > 0) {
            proactiveQuestionContext = `\n## Recent Proactive Questions You Asked (unanswered)\nYou recently sent these curiosity-driven questions via Telegram. If the user's message seems to be answering one of them, acknowledge it warmly and ask a brief follow-up to learn more about them.\n` +
              recentUnanswered.map(q => `- "${q.question}"`).join('\n');
          }
        } catch {}
      }

      let crossChannelContext = '';
      if (userId) {
        try {
          const recentInteractions = await getRecentInteractions(userId, 20);
          crossChannelContext = formatInteractionTimeline(recentInteractions);
        } catch {}
      }

      const soulBlock = await getSoulPromptBlock(userId);
      const daemonPaired = userId ? isUserPaired(userId) : false;
      const [androidActive, daemonDeviceMeta] = daemonPaired && userId
        ? await Promise.all([isAndroidDaemonActive(userId), getDaemonDeviceMeta(userId)])
        : [false, { hostname: null, platform: null }];

      // Build device-specific package hints for Samsung devices (hostname starts with SM-)
      const hostname = daemonDeviceMeta.hostname || '';
      const isSamsung = hostname.startsWith('SM-') || hostname.toLowerCase().includes('samsung');
      const deviceHints = androidActive ? [
        `Device: ${hostname || 'unknown'}`,
        isSamsung ? 'Samsung device — use these package names: Camera=com.sec.android.app.camera, Gallery=com.sec.android.apps.myfiles, Messages=com.samsung.android.messaging, Settings=com.android.settings, Chrome=com.android.chrome, Phone=com.samsung.android.dialer, Contacts=com.samsung.android.contacts, YouTube=com.google.android.youtube, Maps=com.google.android.apps.maps, Gmail=com.google.android.gm, Instagram=com.instagram.android, Spotify=com.spotify.music, Facebook=com.facebook.katana (fallback: com.facebook.lite), Messenger=com.facebook.orca, WhatsApp=com.whatsapp, Snapchat=com.snapchat.android, TikTok=com.ss.android.ugc.trill (fallback: com.zhiliaoapp.musically), Twitter/X=com.twitter.android, Reddit=com.reddit.frontpage, Discord=com.discord, LinkedIn=com.linkedin.android, Amazon=com.amazon.mShop.android.shopping, Netflix=com.netflix.mediaclient, Hulu=com.hulu.plus, Twitch=tv.twitch.android.app, Pinterest=com.pinterest, Uber=com.ubercab, DoorDash=com.dd.doordash, Venmo=com.venmo, Cash App=com.squareup.cash, PayPal=com.paypal.android.p2pmobile, Robinhood=com.robinhood.android, Slack=com.Slack, Zoom=us.zoom.videomeetings, Teams=com.microsoft.teams, Signal=org.thoughtcrime.securesms, Telegram=org.telegram.messenger, Calculator=com.sec.android.app.popupcalculator, Calendar=com.samsung.android.calendar, Clock=com.sec.android.app.clockpackage, Notes=com.samsung.android.app.notes. IMPORTANT: If android_open_app fails with "App not installed", the daemon automatically tries known fallback package names — but you can also try the alternate yourself if the first fails.' : '',
        'For android_press_key, valid keys are ONLY: back, home, recents, volume_up, volume_down, enter — no KEYCODE_ prefix, no camera key.',
        'For taking a photo: open the camera app with android_open_app, use android_screenshot to verify it opened, then ask the user to tap the shutter themselves (or use android_tap with the shutter button coordinates from android_read_screen).',
        'CRITICAL: If any tool returns result:error, you MUST report that failure immediately. NEVER describe a failed action as successful or invent file names, screenshots, or results that were not in the tool response.',
      ].filter(Boolean).join('\n') : '';

      const daemonSection = daemonPaired
        ? androidActive
          ? `Android Device Daemon is ACTIVE and connected.\n${deviceHints}\nAvailable daemon actions: android_open_app, android_browse, android_screenshot, android_read_screen, android_tap, android_type, android_swipe, android_press_key, android_wait, android_file_list, android_file_read, android_notifications_list, notify. DO NOT use desktop shell/file actions.\nSEARCH SHORTCUTS — use android_browse with these deep links (opens native app directly to results): YouTube search → url='vnd.youtube://results?search_query=YOUR_QUERY', Google Maps → url='geo:0,0?q=YOUR_QUERY', Spotify → url='spotify:search:YOUR_QUERY'.\nUI SETTLING — use android_wait (ms: 1500–3000) after tapping interactive elements that trigger loading (videos, pages, navigation) before calling android_read_screen. This prevents read_screen from seeing a blank or transitioning state.\n\nYOUTUBE RESEARCH WORKFLOW — when the user asks to research something on YouTube, find a good video and summarize it:\n  1. Call search_youtube (server-side) with the query. This returns results with channel name, views, date, and video ID — use this to pick a reputable, high-view-count, recent video without touching the phone at all.\n  2. Call fetch_youtube_transcript with the chosen video ID — this fetches the COMPLETE transcript server-side with no truncation.\n  3. Call android_browse with url='vnd.youtube://watch?v=VIDEO_ID' to open the video on the phone so the user can watch it.\n  4. Summarize the transcript content for the user.\n  5. Call notify as the final step (see NOTIFICATIONS below).\n  NEVER navigate YouTube's transcript UI (3-dot menu, Show Transcript, scroll) — always use fetch_youtube_transcript.\n\nNOTIFICATION → YOUTUBE VIDEO WORKFLOW — when the user asks you to open a specific video from their notifications:\n  1. android_notifications_list → find the notification the user mentioned (match by channel name or partial title).\n  2. Extract the YouTube URL from the notification if present. YouTube notification bodies often contain 'youtube.com/watch?v=VIDEO_ID' or the URL is in the intent data. Use android_browse url='vnd.youtube://watch?v=VIDEO_ID' with the exact extracted ID.\n  3. If no URL in notification: use the EXACT video title from the notification as the query for search_youtube, pick the result whose title matches most closely, then open with android_browse url='vnd.youtube://watch?v=VIDEO_ID'.\n  4. android_wait(3000) → android_screenshot → VISUALLY VERIFY the correct video title is on screen before proceeding. If the wrong video loaded, go back (android_press_key: back) and retry with a more specific search query or the exact title.\n  5. NEVER open a search results page and assume the first result is the correct video — always verify the video title matches what the user asked for.\n\nYOUTUBE APP SPATIAL LAYOUT (Galaxy Z Fold 6 cover screen, portrait) — use this as your mental map when navigating:\n  SCREEN ZONES (top to bottom):\n  • Video Player (top ~0–40% of screen): The video plays here. Tapping it toggles play/pause controls.\n  • Title Zone (~40–50%): Video title text + view count + date.\n  • Channel Zone (~50–57%): Channel name + subscriber count + Subscribe/bell button.\n  • Action Row (~57–65%): Like (with count) | Dislike | Share | Ask | Save — horizontally arranged.\n  • Comments Section (~65–78%): IMMEDIATELY VISIBLE below the action row — NO SCROLLING NEEDED. Shows 'Comments [count]' header on the left, then the first comment text directly below it as a preview. This entire block is the tap target to open the full comment list.\n  • Recommended / Store content (below 78%): Sponsored sections, other videos.\n\n  READING COMMENTS STEP-BY-STEP:\n  1. After video opens: android_wait(2500), then android_screenshot to confirm the video loaded.\n  2. The comments section is ALREADY VISIBLE on screen — no scrolling required.\n  3. android_read_screen — the output will contain 'Comments [number]' and the first comment text right there in the page. You can read that first comment immediately.\n  4. To open the full comment list: android_tap at the comments block (~x=450, y=1450 on the Z Fold 6 cover screen — roughly 65% down). This opens a bottom sheet with all comments.\n  5. android_wait(1500), android_screenshot — the comment sheet should now be open.\n  6. android_read_screen to extract the comment text you need.\n  7. If tapping opened the video fullscreen instead: android_press_key(back) to exit fullscreen, then retry tapping the comments block lower on the screen.\n\n  IMPORTANT COORDINATE NOTES:\n  • The Z Fold 6 cover screen is approx 904px wide × 2316px tall. Tap x-coordinates: use x=450 (center). y=1450 targets the comments section.\n  • After every tap, ALWAYS android_wait(1000–1500) then android_screenshot before the next action. This prevents mis-taps on transitioning screens.\n  • The first comment text is readable directly from android_read_screen without tapping anything — use this to answer 'what is the first comment?' type questions instantly.\n\nACTION FLOW for multi-step tasks: Use as many tool-call turns as the task requires — there is no turn limit. For each step: (1) If unsure what is on screen, call android_read_screen first. (2) Act — call android_browse, android_tap, android_swipe, android_type, etc. as needed. (3) After acting, call android_read_screen to confirm the result, then decide the next step. Complete the FULL task end-to-end before responding — do NOT stop mid-task and ask the user to finish. NEVER re-open an app that is already on screen. NEVER describe app content without calling android_read_screen first. If an op returns result:error, tell the user what failed and what you tried.\n\n\nFLAG_SECURE APPS — android_screenshot WILL ALWAYS FAIL for these apps (OS-level block, cannot be bypassed):\n  Facebook (com.facebook.katana / .lite), Instagram (com.instagram.android), WhatsApp (com.whatsapp), Snapchat (com.snapchat.android), Netflix (com.netflix.mediaclient), Disney+ (com.disney.disneyplus), most banking apps, and camera apps.\n  For ANY of these apps, NEVER call android_screenshot — it will always fail. Use android_read_screen instead. android_read_screen reads the accessibility tree and IS available even in FLAG_SECURE apps — it gives you all visible text, button labels, and UI element positions. This is actually MORE useful for understanding content than a screenshot since it returns structured data.\n\nCAMERA TASKS — android_screenshot WILL FAIL inside camera apps (FLAG_SECURE). For any photo task: (1) android_open_app the camera package, (2) android_wait 2000ms to let it load, (3) android_read_screen to see the viewfinder UI and find the shutter button coordinates, (4) android_tap the shutter button, (5) android_wait 1500ms, (6) send notify success banner — do NOT call android_screenshot inside the camera, it will always fail. Trust the shutter tap succeeded and move on.\n\nNOTIFICATIONS — ALWAYS send a notify banner at the end of every multi-step task, success OR failure:\n- SUCCESS: notify with title:'Jarvis ✓', body: one-line summary of what was done (e.g. "Playing Lo-Fi Hip Hop — 2.1M views, posted 3 days ago")\n- FAILURE: notify with title:'Jarvis ✗', body: one-line summary of what went wrong (e.g. "Couldn't get transcript — captions disabled on this video")\nThis ensures the user always gets a phone banner and never waits silently for a task that already ended.\n\nRETURN TO JARVIS — REQUIRED FINAL STEP after every multi-step task:\nAfter calling notify, ALWAYS call android_return_to_jarvis as the very last step. This navigates the phone back to the Jarvis chat in the browser so the user can continue the conversation without having to manually switch apps. The full task loop is always: complete task → notify banner → android_return_to_jarvis. Never skip android_return_to_jarvis on multi-step tasks.\n\nSCREENSHOT DISPLAY — screenshots ARE shown inline in the Jarvis chat as viewable images:\nWhen android_screenshot succeeds, the screenshot is automatically stored and a preview URL is returned. Include a brief description of what the screenshot shows (e.g. "Here's the current Facebook screen:") before the tool result is displayed — the image will appear inline in the chat for the user to see directly.`
          : 'Desktop Daemon is ACTIVE. Use shell, notify, file_read, file_write, file_list actions. ALWAYS report errors immediately if a tool returns result:error. Use daemon_diagnostic (no args) to check daemon health before multi-step sequences or when ops are failing.'
        : '⚠️ NO DAEMON CONNECTED. Do NOT call daemon_action — it will fail with "daemon not connected". If the user asks to control their phone or computer, tell them exactly this: "Your phone daemon isn\'t connected. To fix it: (1) Open the Jarvis app → Profile → scroll to \'Android Device\' → tap \'Get Pairing Code\', (2) Open the Jarvis Daemon APK on your phone, (3) Make sure the Server URL is https://GameplanAI.replit.app, (4) Enter the 8-character pairing code, (5) Tap Pair. The status dot should turn green within a few seconds." Do not attempt daemon_action until they confirm it\'s connected.';
      const systemPrompt = buildCoachSystemPrompt(goals || [], stats || {}, history || [], calendarEvents || [], lifeContext || null, resolvedGmailItems, resolvedGmailConnected, slackMessages || [], slackConnected ?? false, userCommitments, coachingMode, memories, telegramMessages || [], telegramConnected ?? false, morningNoteSummary, documentsContext, crossChannelContext, soulBlock, daemonSection);

      // Detect if the user's current message is a device-control request so we can
      // force tool use rather than letting the model respond with plain text.
      const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
      const lastUserContent = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content.toLowerCase() : '';
      const deviceControlKeywords = [
        'screenshot', 'screen shot', 'screen capture',
        'open youtube', 'open instagram', 'open spotify', 'open chrome', 'open camera',
        'open settings', 'open messages', 'open gmail', 'open maps', 'open the app',
        'launch', 'take a photo', 'tap on', 'tap the', 'swipe', 'read the screen',
        "what's on the screen", 'what is on the screen', 'what does the screen', 'browse to',
        'android_', 'navigate to', 'type into', 'open app',
        // notification keywords
        'notification', 'notifications', 'my notifications', 'read my notification',
        'check notification', 'show notification', 'what notification', 'any notification',
        'new notification', 'recent notification', 'latest notification',
        // general phone/device read actions
        'read my phone', 'check my phone', 'what is on my phone', "what's on my phone",
        'phone screen', 'my screen', 'my phone',
        // youtube / video intelligence
        'transcript', 'summarize the video', 'summarize that video', 'what is the video about',
        "what's the video about", 'give me a summary', 'summarize what', 'tell me what the video',
        'search youtube', 'find a youtube', 'look up on youtube', 'research on youtube',
        'look something up', 'look it up', 'find a video', 'find me a video',
      ];
      const isDeviceControlRequest = androidActive && deviceControlKeywords.some(k => lastUserContent.includes(k));

      // Absolute prohibition injected at the TOP of the system message so the model
      // reads it before any other context. Without this, the model pattern-matches
      // against prior hallucinated assistant messages in the chat history and repeats them.
      const daemonAbsoluteRule = androidActive
        ? `\n⚠️ ABSOLUTE RULE — DEVICE CONTROL: You have ZERO physical ability to open apps, take screenshots, tap, swipe, type, or perform any action on the phone through text alone. The ONLY way ANY phone action can happen is by calling the daemon_action tool and receiving result:'success'. If daemon_action is not called, NOTHING happened on the phone. Prior conversation messages where you (the assistant) described performing phone actions without a daemon_action tool call were ERRORS — do not repeat that pattern. For EVERY phone action request, call daemon_action. Never write "I opened X" or "I took a screenshot" unless daemon_action returned result:'success' in this response.\n`
        : '';

      const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: daemonAbsoluteRule + systemPrompt + proactiveQuestionContext + "\n\nYou can take actions on the user's behalf using the available tools. When a user asks you to add a task, log progress, update their context, etc., use the appropriate tool. Respond naturally — do not mention 'tool calls' or 'functions' to the user. Just confirm what you did conversationally." + (process.env.TAVILY_API_KEY ? "\n\nYou also have a web_search tool. Use it whenever the user asks about current events, live data (weather, stock prices, sports scores, news), or anything requiring real-time information you wouldn't know. Cite your sources naturally in your response." : "") },
        ...messages.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];

      const actionResults: { tool: string; result: 'success' | 'error'; label: string; url?: string; buttonLabel?: string }[] = [];
      let toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      // Track whether the client disconnected mid-stream (e.g. switched to camera app).
      // If so, the full streamed response is saved to DB so it survives the disconnect.
      let clientDisconnected = false;
      let hasDaemonActions = false;
      req.on('close', () => {
        if (!res.writableEnded) clientDisconnected = true;
      });

      // SSE keepalive: once the SSE stream is open, send a comment every 10s so
      // the connection isn't killed by proxies or the Android OS while daemon ops run.
      // Declared here (outer scope) so stopKeepalive() is reachable in the catch block
      // and in the final streaming section that lives outside the if(userId) block.
      let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
      const startKeepalive = () => {
        if (keepaliveInterval) return;
        keepaliveInterval = setInterval(() => {
          if (!res.writableEnded && !res.destroyed) {
            try { res.write(': keepalive\n\n'); } catch {}
          }
        }, 10000);
      };
      const stopKeepalive = () => {
        if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
      };
      // Clean up if the client disconnects mid-stream
      req.on('close', stopKeepalive);

      if (userId) {
        // Multi-turn tool loop: allows the AI to chain sequential daemon ops
        // (e.g. android_browse → android_read_screen → respond) without each
        // needing its own user message. Without this loop the AI was forced to
        // spend its only tool-call turn on daemon_diagnostic, leaving no turn
        // for the actual action it needed to perform.
        const MAX_TOOL_TURNS = 20;
        let loopFinalText: string | null = null; // text returned by model mid-loop

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          const currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            ...chatMessages,
            ...toolMessages,
          ];
          const phase1 = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: currentMessages,
            tools: coachTools,
            // Force a tool call on turn 0 for device-control requests.
            // Subsequent turns use "auto" so the model can stop and respond.
            tool_choice: (turn === 0 && isDeviceControlRequest) ? "required" : "auto",
            max_completion_tokens: 2048,
          });

          const choice = phase1.choices[0];

          // Model finished with text (no more tool calls this turn)
          if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) {
            if (turn === 0 && choice.message.content) {
              // Phase-1-only response (no tools called at all) — run hallucination check
              const responseText = choice.message.content;
              const hallucIndicators = [
                "i've opened", "i opened", "i launched", "i took a screenshot", "i captured",
                "screenshot has been taken", "screenshot taken", "i've taken", "i tapped",
                "i swiped", "i typed", "here is the screenshot", "here's the screenshot",
                "here are your current android notifications",
                "here are your android notifications",
                "here are your notifications",
                "got it — here are your",
                "got it, here are your",
                "your current notifications",
                "your android notifications",
                "fetching your notifications",
                "i'll fetch your android",
                "i will fetch your android",
                "fetched your notifications",
              ];
              const hasRawToolCallBlob = androidActive && (
                responseText.includes('"name":"daemon_action"') ||
                responseText.includes('"name": "daemon_action"') ||
                responseText.includes('android_notifications_list') ||
                responseText.includes('android_open_app') ||
                responseText.includes('android_screenshot') ||
                responseText.includes('android_tap') ||
                responseText.includes('android_read_screen')
              );
              const looksHallucinated = androidActive && (hasRawToolCallBlob || hallucIndicators.some(h => responseText.toLowerCase().includes(h)));
              if (looksHallucinated) {
                console.warn(`[daemon] HALLUCINATION DETECTED userId=${userId} — model claimed device action without tool call. Intercepting.`);
                const correctedResponse = "I wasn't able to perform that action on your phone — I need to call the phone tool to do that, and it didn't get called this time. Please try again and I'll make sure to actually execute the command.";
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.flushHeaders();
                res.write(`data: ${JSON.stringify({ content: correctedResponse })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }
              // Normal conversational response with no tools needed — stream it directly
              res.setHeader('Content-Type', 'text/event-stream');
              res.setHeader('Cache-Control', 'no-cache, no-transform');
              res.setHeader('X-Accel-Buffering', 'no');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.flushHeaders();
              res.write(`data: ${JSON.stringify({ content: responseText })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              extractProfileInBackground(userId, messages);
              markProactiveQuestionsAnswered(userId, messages).catch(() => {});
              const lastUserMsg0 = [...messages].reverse().find((m: any) => m.role === 'user');
              if (lastUserMsg0?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsg0.content === 'string' ? lastUserMsg0.content : JSON.stringify(lastUserMsg0.content)).catch(() => {});
              logInteraction(userId, "app_chat", "outbound", responseText).catch(() => {});
              return;
            }
            // turn > 0: model has finished tool calls and returned its final text.
            // Capture it so we can stream it without calling the model again.
            if (choice.message.content) loopFinalText = choice.message.content;
            break;
          }

          // Model returned tool calls — execute them all, then loop for next turn
          toolMessages.push(choice.message);

          const hasWebSearch = choice.message.tool_calls.some(tc => tc.function.name === 'web_search');
          if (hasWebSearch && !res.headersSent) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.flushHeaders();
            res.write(`data: ${JSON.stringify({ type: 'searching' })}\n\n`);
          }

          for (const tc of choice.message.tool_calls) {
            let args: any = {};
            try { args = JSON.parse(tc.function.arguments); } catch {}

            const isHighStakes = tc.function.name === 'send_email' ||
              (tc.function.name === 'daemon_action' && ['shell', 'file_write'].includes(String(args.action || '')));

            if (isHighStakes) {
              if (!res.headersSent) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.flushHeaders();
              }
              const preview: Record<string, string> = {};
              if (tc.function.name === 'send_email') {
                preview.to = String(args.to || '');
                preview.subject = String(args.subject || '');
                preview.body = String(args.body || '');
                preview.provider = String(args.provider || 'google');
              } else {
                preview.action = String(args.action || '');
                if (args.cmd) preview.cmd = String(args.cmd);
                if (args.path) preview.path = String(args.path);
                if (args.content) preview.content = String(args.content).slice(0, 200);
              }
              const confirmToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
              pendingConfirmations.set(confirmToken, {
                userId,
                tool: tc.function.name,
                args,
                expiresAt: Date.now() + 5 * 60 * 1000,
              });
              res.write(`data: ${JSON.stringify({ type: 'confirm_required', token: confirmToken, tool: tc.function.name, preview })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }

            // For daemon_action: open the SSE stream immediately and emit a
            // "working" event before the op runs. This keeps the HTTP connection
            // alive during multi-turn loops (prevents 60s gateway timeout) and
            // gives the user real-time progress instead of a blank loading state.
            if (tc.function.name === 'daemon_action') {
              hasDaemonActions = true;
              if (!res.headersSent) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.flushHeaders();
              }
              const actionLabel: Record<string, string> = {
                android_browse: 'Opening app on your phone...',
                android_open_app: 'Launching app on your phone...',
                android_read_screen: 'Reading your phone screen...',
                android_tap: 'Tapping the screen...',
                android_swipe: 'Scrolling...',
                android_type: 'Typing on your phone...',
                android_screenshot: 'Taking screenshot...',
                android_press_key: 'Pressing key...',
                android_notifications_list: 'Checking notifications...',
                notify: 'Sending you a notification...',
              };
              const workingMsg = actionLabel[String(args.action || '')] || 'Working on your phone...';
              res.write(`data: ${JSON.stringify({ type: 'working', message: workingMsg })}\n\n`);
              startKeepalive();
            }

            // Before android_return_to_jarvis fires, pre-save any screenshot captured
            // so far as a pending response. This handles the edge case where Chrome
            // reloads (instead of just coming to foreground): the reloaded page fetches
            // the pending response on mount and can display the screenshot immediately.
            if (tc.function.name === 'daemon_action' && String(args.action) === 'android_return_to_jarvis' && userId) {
              const earlyScreenshotUrl = actionResults.find(a => a.screenshotUrl)?.screenshotUrl;
              if (earlyScreenshotUrl) {
                savePendingResponse(userId, loopFinalText || '', earlyScreenshotUrl).catch(() => {});
              }
            }

            const execResult = await executeCoachTool(tc.function.name, args, userId);
            let linkData: { url?: string; buttonLabel?: string; code?: string; channel?: string; screenshotUrl?: string } = {};
            if ((tc.function.name === 'generate_reconnect_link' || tc.function.name === 'connect_channel') && execResult.result === 'success') {
              try { linkData = JSON.parse(execResult.detail); } catch {}
            }
            if (tc.function.name === 'daemon_action' && String(args.action) === 'android_screenshot' && execResult.result === 'success') {
              try { const parsed = JSON.parse(execResult.detail); if (parsed.screenshotUrl) linkData.screenshotUrl = parsed.screenshotUrl; } catch {}
            }
            actionResults.push({ tool: tc.function.name, result: execResult.result, label: execResult.label, ...linkData });
            let toolResultContent: string;
            if (tc.function.name === 'daemon_action' && execResult.result === 'error') {
              toolResultContent = `⛔ DAEMON ACTION FAILED — THE PHONE DID NOT EXECUTE THIS COMMAND.\nAction attempted: ${String(args.action || 'unknown')}\nError: ${execResult.detail || execResult.label}\n\nYou MUST tell the user this specific action FAILED. Do NOT describe it as successful. Do NOT invent what the phone showed or did.`;
            } else {
              toolResultContent = JSON.stringify({ result: execResult.result, detail: execResult.detail });
            }
            toolMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolResultContent,
            });
          }
          // Continue to next turn — model will see tool results and decide what to do next
        }

        // If the model returned its final text during the loop (turn > 0), stream it
        // directly here without re-calling the model (saves one LLM round-trip).
        if (loopFinalText) {
          if (!res.headersSent) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.flushHeaders();
          }
          if (actionResults.length > 0) {
            const nonSearchActions = actionResults.filter(a => a.tool !== 'web_search');
            if (nonSearchActions.length > 0) res.write(`data: ${JSON.stringify({ type: 'actions', actions: nonSearchActions })}\n\n`);
          }
          stopKeepalive();
          // Persist the response if daemon actions were involved — survives client disconnect
          if (hasDaemonActions && userId) {
            const screenshotUrl = actionResults.find(a => a.screenshotUrl)?.screenshotUrl;
            savePendingResponse(userId, loopFinalText, screenshotUrl).catch(() => {});
          }
          res.write(`data: ${JSON.stringify({ content: loopFinalText })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          extractProfileInBackground(userId, messages);
          markProactiveQuestionsAnswered(userId, messages).catch(() => {});
          const lastUserMsgLoop = [...messages].reverse().find((m: any) => m.role === 'user');
          if (lastUserMsgLoop?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsgLoop.content === 'string' ? lastUserMsgLoop.content : JSON.stringify(lastUserMsgLoop.content)).catch(() => {});
          logInteraction(userId, "app_chat", "outbound", loopFinalText).catch(() => {});
          return;
        }
      }

      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.flushHeaders();
      }

      if (actionResults.length > 0) {
        const nonSearchActions = actionResults.filter(a => a.tool !== 'web_search');
        if (nonSearchActions.length > 0) {
          res.write(`data: ${JSON.stringify({ type: 'actions', actions: nonSearchActions })}\n\n`);
        }
      }

      // Inject a hard error summary before the final synthesis if any daemon actions failed.
      // This prevents the AI from hallucinating success when tool calls returned errors.
      const failedDaemonActions = actionResults.filter(a => a.tool === 'daemon_action' && a.result === 'error');
      if (failedDaemonActions.length > 0) {
        // Must be "user" role — "system" injected after tool messages is silently ignored by the API.
        toolMessages.push({
          role: "user" as const,
          content: `⛔ CORRECTION REQUIRED: ${failedDaemonActions.length} phone action(s) just FAILED (see the ⛔ DAEMON ACTION FAILED messages above). Do NOT claim any of those actions succeeded. Do NOT invent search results, app content, or what the phone showed. Report exactly which action failed and why, then offer to retry or suggest an alternative. Failed actions:\n${failedDaemonActions.map(a => `- ${a.label}: ${a.result}`).join('\n')}`,
        });
      }

      const streamMessages = toolMessages.length > 0
        ? [...chatMessages, ...toolMessages]
        : chatMessages;

      const stream = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: streamMessages,
        stream: true,
        max_completion_tokens: 8192,
      });

      stopKeepalive();
      let fullStreamedReply = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullStreamedReply += content;
          if (!clientDisconnected) {
            try { res.write(`data: ${JSON.stringify({ content })}\n\n`); } catch {}
          }
        }
      }

      // Persist if daemon actions ran — response survives connection drops
      if (hasDaemonActions && userId && fullStreamedReply) {
        const screenshotUrl = actionResults.find((a: any) => a.screenshotUrl)?.screenshotUrl;
        savePendingResponse(userId, fullStreamedReply, screenshotUrl).catch(() => {});
      }

      if (!clientDisconnected) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
      if (userId) {
        extractProfileInBackground(userId, messages);
        markProactiveQuestionsAnswered(userId, messages).catch(() => {});
        const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
        if (lastUserMsg?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)).catch(() => {});
        if (fullStreamedReply) logInteraction(userId, "app_chat", "outbound", fullStreamedReply).catch(() => {});
      }
    } catch (error) {
      stopKeepalive();
      console.error("Error in coach chat:", error);
      // Push a failure banner to the phone so the user isn't left waiting silently
      if (userId && isUserPaired(userId)) {
        sendDaemonOp(userId, {
          type: 'notify',
          title: 'Jarvis ✗ Task failed',
          body: 'Something went wrong — check the app for details and try again.',
        }, 5000).catch(() => {});
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to get coach response" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Stream interrupted" })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/coach/execute-confirmed", async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      if (!token) return res.status(400).json({ error: 'token is required' });
      const pending = pendingConfirmations.get(token);
      if (!pending) return res.status(400).json({ error: 'Confirmation token not found or expired' });
      if (pending.userId !== userId) return res.status(403).json({ error: 'Token does not belong to this user' });
      if (pending.expiresAt < Date.now()) {
        pendingConfirmations.delete(token);
        return res.status(400).json({ error: 'Confirmation token has expired' });
      }
      pendingConfirmations.delete(token);
      const execResult = await executeCoachTool(pending.tool, pending.args, userId);
      return res.json({ result: execResult.result, label: execResult.label, detail: execResult.detail });
    } catch (error) {
      console.error('Error in execute-confirmed:', error);
      return res.status(500).json({ error: 'Failed to execute confirmed action' });
    }
  });

  app.post("/api/coach/decline-action", async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      let tool = 'unknown';
      let preview: Record<string, string> = {};
      if (token) {
        const pending = pendingConfirmations.get(token);
        if (pending && pending.userId === userId) {
          tool = pending.tool;
          const a = pending.args;
          if (tool === 'send_email') preview = { to: a.to || '', subject: a.subject || '' };
          else preview = { action: a.action || '', cmd: a.cmd || '', path: a.path || '' };
          pendingConfirmations.delete(token);
        }
      }
      const toolLabel = tool === 'send_email'
        ? `sending an email to ${preview.to || 'the recipient'}`
        : `running a terminal command (${preview.cmd || preview.action || 'shell'})`;
      const prompt = `The user has just declined an action you proposed. You were about to ${toolLabel} but they cancelled. Acknowledge briefly and naturally in one sentence — do not re-propose the action. Stay in your coaching persona.`;
      const resp = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 80,
      });
      const content = resp.choices[0]?.message?.content || 'Got it — I won\'t proceed with that action.';
      return res.json({ content });
    } catch (error) {
      console.error('Error in decline-action:', error);
      return res.json({ content: 'Got it — I\'ll leave that for now.' });
    }
  });

  app.post("/api/coach/suggestions", async (req: Request, res: Response) => {
    try {
      const { lastAssistantMessage, goals, coachingMode } = req.body;
      if (!lastAssistantMessage) {
        return res.json({ actions: [], followups: [] });
      }

      const prompt = `Analyze this coaching message and extract structured suggestions.

Coaching message:
"${lastAssistantMessage}"

User's active goals:
${(goals || []).map((g: any) => `- ${g.title} (${g.category})`).join('\n') || 'None set'}

Return a JSON object with:
1. "actions": array of 0-2 actionable suggestions. Three action types are supported:
   - { "type": "task", "title": string (verb phrase), "category": "fitness"/"finance"/"career"/"personal"/"social", "priority": "high"/"medium"/"low", "description": one-line context }
   - { "type": "goal", "title": string, "category": "fitness"/"finance"/"career"/"personal"/"social", "description": one-line context }
   - { "type": "link", "title": string, "buttonLabel": string (short CTA ≤4 words), "url": string (use "profile://connections" to open connection settings, or a full https:// URL), "category": "personal" } — Use ONLY when the message explicitly suggests connecting/reconnecting Google, Microsoft, Outlook, or Gmail.
   Only include actions that are specific and actionable. Return empty array for purely conversational messages.
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
      const { goals, stats, history, lifeContext, coachingMode } = req.body;
      const userId = req.userId;

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

      let commitmentText = '';
      if (userId) {
        try {
          const pendingCommitments = await db
            .select()
            .from(schema.commitments)
            .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
            .limit(5);
          if (pendingCommitments.length > 0) {
            commitmentText = `\n- Open commitments: ${pendingCommitments.map((c: any) => `"${c.content}"${c.dueDate ? ` (due ${c.dueDate})` : ''}`).join(', ')}`;
          }
        } catch {}
      }
      const persona = getPersonaBlock(coachingMode);

      const prompt = `You are a personal productivity coach. Write a 1-2 sentence daily coaching note for this person.

${persona}

Their profile:
- Streak: ${stats?.streak || 0} days, ${completionRate}% task completion this week
- Goals: ${goalsText}
- Recently completed: ${completedHistory.slice(0, 4).map((h: any) => h.title).join(', ') || 'nothing yet'}
- Recently skipped: ${skippedHistory.slice(0, 3).map((h: any) => h.title).join(', ') || 'nothing'}${lifeCtxText}${commitmentText}

Write ONE short, specific coaching observation. Be direct — name what's working or what to fix. If they have a clear priority or blocker, reference it specifically. If they have open commitments, call out specific ones by name. No greeting, no sign-off.

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
        model: "gpt-5-mini",
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
          const emailId = matchedEmail.messageId
            ? `gmail:${matchedEmail.messageId}`
            : `gmail:${matchedEmail.subject}:${matchedEmail.from || ''}`;
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
        const { refreshGoogleToken } = await import('./userTokenStore');
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
      const { tasks, calendarEvents, goals, stats, energyLevel } = req.body;

      if (typeof energyLevel !== 'number' || energyLevel < 1 || energyLevel > 5) {
        return res.status(400).json({ error: "energyLevel must be a number between 1 and 5" });
      }

      const taskList = Array.isArray(tasks) ? tasks : [];
      const eventList = Array.isArray(calendarEvents) ? calendarEvents : [];
      const goalList = Array.isArray(goals) ? goals : [];

      const tasksText = taskList.length > 0
        ? taskList.map((t: any) => `- [${t.priority || 'medium'}] ${t.title}${t.description ? ': ' + t.description : ''} (id: ${t.id})`).join('\n')
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
        model: "gpt-5-mini",
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

  app.post("/api/coach/transcribe", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { audio } = req.body;
      if (!audio || typeof audio !== 'string') {
        return res.status(400).json({ error: "audio (base64) is required" });
      }

      const { speechToText, detectAudioFormat } = await import('./replit_integrations/audio/client');
      const rawBuffer = Buffer.from(audio, 'base64');
      const format = detectAudioFormat(rawBuffer);
      const text = await speechToText(rawBuffer, format);
      res.json({ text });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });

  app.post("/api/coach/speak", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { text, voice } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: "text is required" });
      }

      let trimmedText = text.slice(0, 4000);
      if (text.length > 4000) {
        const lastSentence = trimmedText.lastIndexOf('.');
        if (lastSentence > 0) {
          trimmedText = trimmedText.slice(0, lastSentence + 1);
        }
      }

      const { textToSpeech } = await import('./replit_integrations/audio/client');
      const audioBuffer = await textToSpeech(trimmedText, voice || 'alloy', 'mp3');
      res.json({ audio: audioBuffer.toString('base64') });
    } catch (error) {
      console.error("Error generating speech:", error);
      res.status(500).json({ error: "Failed to generate speech" });
    }
  });

  app.get("/api/commitments", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db
        .select()
        .from(schema.commitments)
        .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
        .orderBy(desc(schema.commitments.extractedAt));
      res.json({ commitments: rows });
    } catch (error) {
      console.error("Error fetching commitments:", error);
      res.status(500).json({ error: "Failed to fetch commitments" });
    }
  });

  app.put("/api/commitments/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      const { status } = req.body;
      if (!status || !['done', 'skipped', 'pending'].includes(status)) {
        return res.status(400).json({ error: "status must be 'done', 'skipped', or 'pending'" });
      }
      await db
        .update(schema.commitments)
        .set({ status, resolvedAt: status !== 'pending' ? new Date() : null })
        .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error updating commitment:", error);
      res.status(500).json({ error: "Failed to update commitment" });
    }
  });

  app.delete("/api/commitments/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db
        .delete(schema.commitments)
        .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, userId)));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting commitment:", error);
      res.status(500).json({ error: "Failed to delete commitment" });
    }
  });

  app.post("/api/commitments/extract", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { message } = req.body;
      if (!message || typeof message !== 'string') {
        return res.json({ hasCommitment: false });
      }

      const prompt = `Did this message from the user contain any explicit commitment ('I will', 'I'll', 'by tomorrow', 'I need to', 'I'm going to', 'I promise', 'I plan to', 'I'm committing to')? If yes, extract the commitment. Today's date is ${new Date().toISOString().split('T')[0]}.

User message: "${message}"

Return ONLY JSON: { "hasCommitment": boolean, "commitment": "the thing they committed to" or null, "dueDate": "YYYY-MM-DD" or null }`;

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 200,
      });

      const content = response.choices[0]?.message?.content || '{"hasCommitment":false}';
      const parsed = JSON.parse(content);

      if (parsed.hasCommitment && parsed.commitment) {
        await db.insert(schema.commitments).values({
          userId,
          content: parsed.commitment,
          dueDate: parsed.dueDate || null,
          sourceMessage: message,
        });
        res.json({ hasCommitment: true, commitment: parsed.commitment, dueDate: parsed.dueDate || null });
      } else {
        res.json({ hasCommitment: false });
      }
    } catch (error) {
      console.error("Error extracting commitment:", error);
      res.json({ hasCommitment: false });
    }
  });

  app.post("/api/coach/proactive", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { context, goals, stats, history, lifeContext } = req.body;
      if (!context) return res.status(400).json({ error: "context is required" });

      let userCommitments: any[] = [];
      try {
        userCommitments = await db
          .select()
          .from(schema.commitments)
          .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
          .orderBy(desc(schema.commitments.extractedAt))
          .limit(10);
      } catch {}

      const soulBlock = await getSoulPromptBlock(userId);
      const systemPrompt = buildCoachSystemPrompt(goals || [], stats || {}, history || [], [], lifeContext || null, [], false, [], false, userCommitments, undefined, [], [], false, undefined, undefined, undefined, soulBlock);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.flushHeaders();

      const stream = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt + `\n\nIMPORTANT: You are initiating the conversation proactively — the user hasn't said anything yet. Address the following accountability context directly. Be brief (2-3 sentences max). Don't greet — get right to the point.\n\nAccountability context:\n${context}` },
          { role: "user", content: "[Jarvis is checking in proactively — no user message. Address the accountability context above.]" },
        ],
        stream: true,
        max_completion_tokens: 300,
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
      console.error("Error in proactive coach:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate proactive message" });
      } else {
        res.end();
      }
    }
  });

  // Returns today's morning brief if one was generated and stored by the
  // proactive scheduler. The frontend uses this to show the exact same text
  // in the Insights chat that was already sent to Telegram/daemon — no re-generation.
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
      console.error('Error fetching morning brief:', err);
      return res.json({ text: null });
    }
  });

  // Saves the final Jarvis response to the DB so it survives connection drops
  // (e.g. when the user switches to a camera app and Chrome is backgrounded).
  // The response is stored under userPreferences.data.pendingResponse with a
  // unique ID and timestamp. The frontend fetches and clears it on mount.
  // screenshotUrl is optional — included when a screenshot was taken during the task.
  async function savePendingResponse(userId: string, text: string, screenshotUrl?: string) {
    const id = `pr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const rows = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq(userPreferences.userId, userId));
    const prefs = (rows[0]?.data as any) || {};
    const payload: any = { id, text, createdAt: Date.now() };
    if (screenshotUrl) payload.screenshotUrl = screenshotUrl;
    await db.insert(userPreferences).values({ userId, data: { ...prefs, pendingResponse: payload } })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { data: { ...prefs, pendingResponse: payload } } });
  }

  // Returns the latest pending daemon-task response (if any) and immediately clears it.
  // Called by the frontend on mount / focus to recover messages lost during app-switching.
  app.get("/api/coach/pending-response", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq(userPreferences.userId, userId));
      const prefs = (rows[0]?.data as any) || {};
      const pending = prefs.pendingResponse;
      const ONE_HOUR = 60 * 60 * 1000;
      if (pending && pending.createdAt && (Date.now() - pending.createdAt) < ONE_HOUR && pending.text) {
        // Clear after returning — one-shot delivery
        const updated = { ...prefs, pendingResponse: null };
        await db.update(userPreferences).set({ data: updated }).where(eq(userPreferences.userId, userId));
        return res.json({ id: pending.id, text: pending.text, screenshotUrl: pending.screenshotUrl || null });
      }
      return res.json({ text: null });
    } catch (err) {
      console.error('Error fetching pending response:', err);
      return res.json({ text: null });
    }
  });

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
          .where(eq(schema.commitments.userId, userId))
          .orderBy(desc(schema.commitments.extractedAt))
          .limit(30);
        weekCommitments = weekCommitments.filter((c: any) =>
          new Date(c.extractedAt).getTime() >= sevenDaysAgo.getTime()
        );
      } catch {}

      const completedHistory = (history || []).filter((h: any) => h.completed);
      const skippedHistory = (history || []).filter((h: any) => !h.completed);
      const doneCommitments = weekCommitments.filter((c: any) => c.status === 'done');
      const pendingCommitments = weekCommitments.filter((c: any) => c.status === 'pending');

      const prompt = `Generate a weekly productivity review. Be specific and direct.

This week's data:
- Tasks completed: ${completedHistory.length} (${completedHistory.slice(0, 10).map((h: any) => h.title).join(', ') || 'none'})
- Tasks skipped/incomplete: ${skippedHistory.length} (${skippedHistory.slice(0, 10).map((h: any) => h.title).join(', ') || 'none'})
- Commitments made: ${weekCommitments.length}
- Commitments fulfilled: ${doneCommitments.length} (${doneCommitments.map((c: any) => c.content).join(', ') || 'none'})
- Commitments still pending: ${pendingCommitments.length} (${pendingCommitments.map((c: any) => c.content).join(', ') || 'none'})
- Goals: ${(goals || []).map((g: any) => `${g.title} (${g.current}/${g.target} ${g.unit})`).join(', ') || 'none'}
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
        model: "gpt-5-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || '{}';
      try {
        const parsed = JSON.parse(content);
        res.json({
          headline: parsed.headline || 'Week in review',
          wins: Array.isArray(parsed.wins) ? parsed.wins : [],
          patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
          avoided: Array.isArray(parsed.avoided) ? parsed.avoided : [],
          nextWeekFocus: parsed.nextWeekFocus || '',
        });
      } catch {
        res.json({ headline: 'Week in review', wins: [], patterns: [], avoided: [], nextWeekFocus: '' });
      }
    } catch (error) {
      console.error("Error generating weekly review:", error);
      res.status(500).json({ error: "Failed to generate weekly review" });
    }
  });

  app.get("/api/memories", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select()
        .from(userMemories)
        .where(eq(userMemories.userId, userId))
        .orderBy(desc(userMemories.extractedAt));
      res.json({ memories: rows });
    } catch (error) {
      console.error("Error fetching memories:", error);
      res.status(500).json({ error: "Failed to fetch memories" });
    }
  });

  app.delete("/api/memories/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db.delete(userMemories)
        .where(sql`${userMemories.id} = ${id} AND ${userMemories.userId} = ${userId}`);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting memory:", error);
      res.status(500).json({ error: "Failed to delete memory" });
    }
  });

  app.post("/api/memories/extract", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { messages } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.json({ added: 0 });
      }

      const conversationText = messages
        .map((m: any) => `${m.role}: ${m.content}`)
        .join('\n');

      const stored = await extractAndStore({
        userId,
        source: conversationText,
        sourceType: "chat",
      });
      res.json({ added: stored.length });
    } catch (error) {
      console.error("Error extracting memories:", error);
      res.json({ added: 0 });
    }
  });

  app.get("/api/soul", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const soul = await getSoul(userId);
      res.json(soul);
    } catch (error) {
      console.error("Error fetching SOUL:", error);
      res.status(500).json({ error: "Failed to fetch SOUL" });
    }
  });

  app.post("/api/soul/regenerate", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const soul = await regenerateSoul(userId);
      res.json(soul);
    } catch (error) {
      console.error("Error regenerating SOUL:", error);
      res.status(500).json({ error: "Failed to regenerate SOUL" });
    }
  });

  app.put("/api/soul/override", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const body = req.body as { override?: unknown };
      const override = typeof body.override === "string" ? body.override : null;
      await setManualOverride(userId, override);
      const soul = await getSoul(userId);
      res.json(soul);
    } catch (error) {
      console.error("Error setting SOUL override:", error);
      res.status(500).json({ error: "Failed to set override" });
    }
  });

  // Edit the canonical SOUL document (JARVIS_SOUL.md content) directly.
  // Distinct from /override — this rewrites the source of truth.
  app.put("/api/soul/content", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const body = req.body as { content?: unknown };
      const content = typeof body.content === "string" ? body.content : "";
      await setSoulContent(userId, content);
      const soul = await getSoul(userId);
      res.json(soul);
    } catch (error) {
      console.error("Error saving SOUL content:", error);
      res.status(500).json({ error: "Failed to save SOUL content" });
    }
  });

  app.get("/api/people", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const people = await listPeople(userId);
      res.json({ people });
    } catch (error) {
      console.error("Error fetching people:", error);
      res.status(500).json({ error: "Failed to fetch people" });
    }
  });

  app.delete("/api/people/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await deletePerson(userId, req.params.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting person:", error);
      res.status(500).json({ error: "Failed to delete person" });
    }
  });

  // Phase 4 — surface the most recent weekly pattern review in the
  // Insights tab. We return the latest row per user; the frontend
  // renders the patterns and summary in plain English.
  app.get("/api/weekly-insights", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db
        .select()
        .from(schema.weeklyInsights)
        .where(eq(schema.weeklyInsights.userId, userId))
        .orderBy(desc(schema.weeklyInsights.createdAt))
        .limit(4);
      return res.json({ insights: rows });
    } catch (error) {
      console.error("Error getting weekly insights:", error);
      return res.status(500).json({ error: "Failed to get weekly insights" });
    }
  });

  app.get("/api/preferences", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const row = await db.select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      return res.json(row[0]?.data || {});
    } catch (error) {
      console.error("Error getting preferences:", error);
      return res.status(500).json({ error: "Failed to get preferences" });
    }
  });

  app.patch("/api/preferences", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const updates = req.body;
      const existing = await db.select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const current = (existing[0]?.data as any) || {};
      const merged = { ...current, ...updates };
      await db.insert(schema.userPreferences)
        .values({ userId, data: merged })
        .onConflictDoUpdate({
          target: schema.userPreferences.userId,
          set: { data: merged, updatedAt: new Date() },
        });
      return res.json(merged);
    } catch (error) {
      console.error("Error saving preferences:", error);
      return res.status(500).json({ error: "Failed to save preferences" });
    }
  });

  app.get("/api/morning-voice-notes", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const limit = parseInt(req.query.limit as string) || 30;
      const notes = await db.select()
        .from(morningVoiceNotes)
        .where(eq(morningVoiceNotes.userId, userId))
        .orderBy(desc(morningVoiceNotes.recordedAt))
        .limit(limit);
      res.json({ notes });
    } catch (error) {
      console.error("Error fetching morning voice notes:", error);
      res.status(500).json({ error: "Failed to fetch morning voice notes" });
    }
  });

  app.get("/api/morning-voice-notes/today", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const today = await getUserLocalDate(userId);
      const notes = await db.select()
        .from(morningVoiceNotes)
        .where(and(eq(morningVoiceNotes.userId, userId), eq(morningVoiceNotes.recordedAt, today)))
        .limit(1);
      res.json({ note: notes[0] || null });
    } catch (error) {
      console.error("Error fetching today's morning voice note:", error);
      res.status(500).json({ error: "Failed to fetch today's morning voice note" });
    }
  });

  async function extractMorningNoteSignals(transcript: string) {
    const extractionPrompt = `Analyze this morning voice note transcript and extract structured data.

Transcript: "${transcript}"

Extract:
1. moodSignal: one of "calm", "energized", "stressed", "overwhelmed", "uncertain" — infer from tone and content
2. themes: up to 5 short topic phrases mentioned (e.g. "client presentation", "exercise", "sleep quality")
3. blockers: up to 3 things preventing progress (e.g. "waiting on feedback", "too many meetings")
4. wins: up to 3 positive things mentioned (e.g. "finished report", "good workout")
5. intention: one sentence capturing what they want to accomplish or focus on today

Return JSON: { "moodSignal": "...", "themes": [...], "blockers": [...], "wins": [...], "intention": "..." }
Return ONLY the JSON object.`;

    const extraction = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: extractionPrompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 400,
    });

    const extractionContent = extraction.choices[0]?.message?.content || '{}';
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(extractionContent); } catch {}

    const validMoods = ['calm', 'energized', 'stressed', 'overwhelmed', 'uncertain'];
    const moodSignal = validMoods.includes(parsed.moodSignal as string) ? (parsed.moodSignal as string) : 'calm';
    const themes = Array.isArray(parsed.themes) ? parsed.themes.slice(0, 5).map(String) : [];
    const blockers = Array.isArray(parsed.blockers) ? parsed.blockers.slice(0, 3).map(String) : [];
    const wins = Array.isArray(parsed.wins) ? parsed.wins.slice(0, 3).map(String) : [];
    const intention = typeof parsed.intention === 'string' ? parsed.intention : null;

    return { moodSignal, themes, blockers, wins, intention };
  }

  app.post("/api/morning-voice-notes/extract", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { transcript } = req.body;
      if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
        return res.status(400).json({ error: "transcript is required" });
      }

      const extracted = await extractMorningNoteSignals(transcript.trim());
      res.json({ extracted });
    } catch (error) {
      console.error("Error extracting morning note signals:", error);
      res.status(500).json({ error: "Failed to extract signals" });
    }
  });

  app.post("/api/morning-voice-notes", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { transcript, extracted: preExtracted } = req.body;
      if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
        return res.status(400).json({ error: "transcript is required" });
      }

      const today = await getUserLocalDate(userId);

      const existing = await db.select({ id: morningVoiceNotes.id })
        .from(morningVoiceNotes)
        .where(and(eq(morningVoiceNotes.userId, userId), eq(morningVoiceNotes.recordedAt, today)))
        .limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: "Morning note already recorded today" });
      }

      const extracted = preExtracted && preExtracted.moodSignal
        ? preExtracted
        : await extractMorningNoteSignals(transcript.trim());

      const validMoods = ['calm', 'energized', 'stressed', 'overwhelmed', 'uncertain'];
      const moodSignal = validMoods.includes(extracted.moodSignal) ? extracted.moodSignal : 'calm';
      const themes = Array.isArray(extracted.themes) ? extracted.themes.slice(0, 5).map(String) : [];
      const blockers = Array.isArray(extracted.blockers) ? extracted.blockers.slice(0, 3).map(String) : [];
      const wins = Array.isArray(extracted.wins) ? extracted.wins.slice(0, 3).map(String) : [];
      const intention = typeof extracted.intention === 'string' ? extracted.intention : null;

      const [inserted] = await db.insert(morningVoiceNotes).values({
        userId,
        recordedAt: today,
        transcript: transcript.trim(),
        moodSignal,
        themes,
        blockers,
        wins,
        intention,
      }).returning();

      const memorySummary = `Morning note (${today}): Mood=${moodSignal}. Themes: ${themes.join(', ') || 'none'}. ${intention ? `Intention: ${intention}` : ''}`;
      try {
        await db.insert(userMemories).values({
          userId,
          content: memorySummary,
          category: 'pattern',
        });
      } catch {}

      morningNoteSummaryCache.delete(userId);

      res.json({
        note: inserted,
        extracted: { moodSignal, themes, blockers, wins, intention },
      });
    } catch (error) {
      console.error("Error creating morning voice note:", error);
      res.status(500).json({ error: "Failed to create morning voice note" });
    }
  });

  app.post("/api/morning-voice-notes/transcribe", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { audioBase64, mimeType } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: "audioBase64 is required" });
      }

      const buffer = Buffer.from(audioBase64, 'base64');
      const ext = (mimeType || 'audio/webm').includes('mp4') ? 'mp4' : 'webm';
      const file = new File([buffer], `recording.${ext}`, { type: mimeType || 'audio/webm' });

      const transcription = await openai.audio.transcriptions.create({
        model: "whisper-1",
        file,
      });

      res.json({ transcript: transcription.text || '' });
    } catch (error) {
      console.error("Error transcribing audio:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });

  app.get("/api/inbox/items", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const items = await db
        .select()
        .from(schema.inboxItems)
        .where(and(eq(schema.inboxItems.userId, userId), eq(schema.inboxItems.status, "pending")))
        .orderBy(desc(schema.inboxItems.surfacedAt));
      res.json(items);
    } catch (error) {
      console.error("Error fetching inbox items:", error);
      res.status(500).json({ error: "Failed to fetch inbox items" });
    }
  });

  app.post("/api/inbox/items/:id/important", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;

      const [item] = await db
        .select()
        .from(schema.inboxItems)
        .where(and(eq(schema.inboxItems.id, id), eq(schema.inboxItems.userId, userId)));

      if (!item) return res.status(404).json({ error: "Item not found" });

      if (item.sourceType === "email" || item.sourceType === "gmail") {
        const senderPart = item.sender
          ? `emails from ${item.sender}`
          : item.subject
            ? `emails with subject "${item.subject}"`
            : "this type of email";
        const memoryContent = `User marked as important: ${senderPart}${item.snippet ? ` — "${item.snippet.slice(0, 120)}"` : ""}. Always surface similar emails.`;

        await db.insert(schema.userMemories).values({
          userId,
          content: memoryContent,
          category: "Email Pattern",
          confidence: 95,
          relevanceScore: 80,
          sourceType: "email_pattern",
          sourceRef: item.sourceId || null,
        });

        const senderDomain = item.sender
          ? (item.sender.match(/@([a-zA-Z0-9.-]+)/)?.[1] || "").toLowerCase()
          : "";
        const senderEmail = item.sender ? item.sender.toLowerCase() : "";

        const subjectKw = (item.subject || "").toLowerCase().trim().slice(0, 60);
        const canCreateRule = senderDomain || subjectKw.length > 0;

        if (canCreateRule) {
          const matchHints = senderDomain
            ? { domains: [senderDomain], senders: senderEmail ? [senderEmail] : [] }
            : { subjectKeywords: [subjectKw] };
          const pattern = senderDomain
            ? `Always surface emails from ${senderDomain}`
            : `Always surface: "${item.subject}"`;

          const { getUserInboxRules } = await import("./inboxRules");
          const existingRules = await getUserInboxRules(userId);
          const alreadyExists = existingRules.some(r => {
            if (r.type !== "surface" || r.scope !== "email") return false;
            const hints = (r.matchHints || {}) as { domains?: string[]; subjectKeywords?: string[] };
            if (senderDomain && hints.domains?.includes(senderDomain)) return true;
            if (!senderDomain && subjectKw && hints.subjectKeywords?.includes(subjectKw)) return true;
            return false;
          });

          if (!alreadyExists) {
            await db.insert(schema.inboxRules).values({
              userId,
              type: "surface",
              scope: "email",
              pattern,
              matchHints,
              source: "user",
            });
          }
        }
      }

      await db
        .update(schema.inboxItems)
        .set({ status: "important", actedAt: new Date() })
        .where(and(eq(schema.inboxItems.id, id), eq(schema.inboxItems.userId, userId)));

      res.json({ success: true, message: "Saved to Jarvis memory" });
    } catch (error) {
      console.error("Error marking inbox item as important:", error);
      res.status(500).json({ error: "Failed to mark as important" });
    }
  });

  // ── Jarvis Scheduled Tasks (Mission Control calendar) ──────────────────
  app.get("/api/jarvis/scheduled-tasks", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const tasks = await db
        .select()
        .from(schema.jarvisScheduledTasks)
        .where(eq(schema.jarvisScheduledTasks.userId, userId))
        .orderBy(schema.jarvisScheduledTasks.scheduledAt);
      res.json(tasks);
    } catch (err) {
      console.error("Error fetching jarvis scheduled tasks:", err);
      res.status(500).json({ error: "Failed to fetch scheduled tasks" });
    }
  });

  app.post("/api/jarvis/scheduled-tasks", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { title, description, scheduledAt, recurrence } = req.body;
      if (!title || !scheduledAt) return res.status(400).json({ error: "title and scheduledAt are required" });
      const [task] = await db
        .insert(schema.jarvisScheduledTasks)
        .values({ userId, title, description: description || null, scheduledAt: new Date(scheduledAt), recurrence: recurrence || null })
        .returning();
      res.json(task);
    } catch (err) {
      console.error("Error creating jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to create scheduled task" });
    }
  });

  app.patch("/api/jarvis/scheduled-tasks/:id/complete", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db
        .update(schema.jarvisScheduledTasks)
        .set({ completedAt: new Date() })
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("Error completing jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to complete task" });
    }
  });

  app.delete("/api/jarvis/scheduled-tasks/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db
        .delete(schema.jarvisScheduledTasks)
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  // ── System schedule: recurring Jarvis CRON tasks (read-only, no auth scope needed) ──
  app.get("/api/jarvis/system-schedule", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const DAYS: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
    const LABELS: Record<string, string> = {
      morning: 'Morning Brief → Telegram',
      commitment_check: 'Commitment Check → Telegram',
      followup_check: 'Follow-Up Check → Telegram',
      momentum_nudge: 'Momentum Nudge → Telegram',
      weekly_planning: 'Weekly Planning Brief → Telegram',
      morning_plan_build: 'Build Today\'s Task Plan',
      email_scan: 'Email Alert Scan',
      weekly_pattern: 'Weekly Pattern Analysis',
    };
    const ICONS: Record<string, string> = {
      morning: 'sunny-outline',
      commitment_check: 'checkmark-circle-outline',
      followup_check: 'refresh-circle-outline',
      momentum_nudge: 'flash-outline',
      weekly_planning: 'calendar-outline',
      morning_plan_build: 'construct-outline',
      email_scan: 'mail-outline',
      weekly_pattern: 'analytics-outline',
    };
    const recurring = [
      { id: 'sys_morning_plan', type: 'morning_plan_build', hour: 7, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_morning',      type: 'morning',            hour: 8, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_commit',       type: 'commitment_check',   hour: 10, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_followup',     type: 'followup_check',     hour: 12, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_nudge',        type: 'momentum_nudge',     hour: 14, minute: 0, recurrence: 'daily', dayOfWeek: null },
      { id: 'sys_email_scan',   type: 'email_scan',         hour: -1, minute: -1, recurrence: 'every 30 min', dayOfWeek: null },
      { id: 'sys_weekly_plan',  type: 'weekly_planning',    hour: 19, minute: 0, recurrence: 'weekly', dayOfWeek: 0 },
      { id: 'sys_weekly_pat',   type: 'weekly_pattern',     hour: 3,  minute: 0, recurrence: 'weekly', dayOfWeek: 0 },
    ].map(t => ({
      ...t,
      label: LABELS[t.type] ?? t.type,
      icon: ICONS[t.type] ?? 'time-outline',
      timeLabel: t.hour < 0 ? 'Continuous' : `${t.hour === 0 ? 12 : t.hour > 12 ? t.hour - 12 : t.hour}:${String(t.minute).padStart(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}`,
      dayLabel: t.recurrence === 'weekly' && t.dayOfWeek !== null ? DAYS[t.dayOfWeek] : 'Every day',
      isSystem: true,
    }));
    res.json(recurring);
  });

  app.post("/api/inbox/items/:id/action", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      const { actionType } = req.body;
      if (!actionType) return res.status(400).json({ error: "actionType is required" });

      let telegramChatId: string | undefined;
      try {
        const [link] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
        telegramChatId = link?.chatId;
      } catch {}

      const { executeInboxAction } = await import("./inboxActions");
      const result = await executeInboxAction(userId, id, actionType, telegramChatId);
      res.json(result);
    } catch (error) {
      console.error("Error executing inbox action:", error);
      res.status(500).json({ error: "Failed to execute action" });
    }
  });

  app.get("/api/inbox/rules", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rules = await db
        .select()
        .from(schema.inboxRules)
        .where(eq(schema.inboxRules.userId, userId));
      res.json(rules);
    } catch (error) {
      console.error("Error fetching inbox rules:", error);
      res.status(500).json({ error: "Failed to fetch rules" });
    }
  });

  app.post("/api/inbox/rules", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { pattern, type, scope } = req.body;
      if (!pattern || !type || !scope) {
        return res.status(400).json({ error: "pattern, type, and scope are required" });
      }
      const { createRuleFromText } = await import("./inboxRules");
      const rule = await createRuleFromText(userId, pattern, type, scope);
      res.json(rule);
    } catch (error) {
      console.error("Error creating inbox rule:", error);
      res.status(500).json({ error: "Failed to create rule" });
    }
  });

  app.delete("/api/inbox/rules/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db
        .delete(schema.inboxRules)
        .where(and(eq(schema.inboxRules.id, id), eq(schema.inboxRules.userId, userId)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting inbox rule:", error);
      res.status(500).json({ error: "Failed to delete rule" });
    }
  });

  app.patch("/api/inbox/rules/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      const { active } = req.body;
      await db
        .update(schema.inboxRules)
        .set({ active: active ? "true" : "false", updatedAt: new Date() })
        .where(and(eq(schema.inboxRules.id, id), eq(schema.inboxRules.userId, userId)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating inbox rule:", error);
      res.status(500).json({ error: "Failed to update rule" });
    }
  });

  app.get("/api/email-drafts", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const drafts = await db
        .select()
        .from(schema.emailDrafts)
        .where(and(eq(schema.emailDrafts.userId, userId), eq(schema.emailDrafts.status, "pending_approval")))
        .orderBy(desc(schema.emailDrafts.createdAt));
      res.json(drafts);
    } catch (error) {
      console.error("Error fetching email drafts:", error);
      res.status(500).json({ error: "Failed to fetch drafts" });
    }
  });

  app.post("/api/email-drafts/:id/approve", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      const { editedSubject, editedBody } = req.body as { editedSubject?: string; editedBody?: string };

      const [draft] = await db
        .select()
        .from(schema.emailDrafts)
        .where(and(eq(schema.emailDrafts.id, id), eq(schema.emailDrafts.userId, userId)))
        .limit(1);
      if (!draft) return res.status(404).json({ error: "Draft not found" });
      if (draft.status !== "pending_approval") return res.status(400).json({ error: "Draft already actioned" });

      const subject = editedSubject?.trim() || draft.draftSubject;
      const body = editedBody?.trim() || draft.draftBody;
      const recipientMatch = (draft.fromSender || "").match(/<([^>]+)>/);
      const recipient = recipientMatch ? recipientMatch[1] : (draft.fromSender || "").trim();
      if (!recipient || !recipient.includes("@")) {
        return res.status(400).json({ error: "Could not determine recipient address" });
      }

      const tokens = await getValidGoogleTokens(userId);
      const token = tokens?.[0];
      if (!token) return res.status(400).json({ error: "Gmail not connected" });

      const { createGmailDraft } = await import("./integrations/gmail");
      const result = await createGmailDraft(token, recipient, subject, body);

      await db
        .update(schema.emailDrafts)
        .set({
          status: "approved",
          gmailDraftId: result.draftId,
          gmailDraftUrl: result.gmailUrl,
          actedAt: new Date(),
          draftSubject: subject,
          draftBody: body,
        })
        .where(eq(schema.emailDrafts.id, id));

      res.json({ success: true, gmailDraftUrl: result.gmailUrl });
    } catch (error) {
      console.error("Error approving email draft:", error);
      res.status(500).json({ error: "Failed to approve draft" });
    }
  });

  app.post("/api/email-drafts/:id/discard", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db
        .update(schema.emailDrafts)
        .set({ status: "discarded", actedAt: new Date() })
        .where(and(eq(schema.emailDrafts.id, id), eq(schema.emailDrafts.userId, userId)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error discarding email draft:", error);
      res.status(500).json({ error: "Failed to discard draft" });
    }
  });

  // ── Phase 3: Sub-agent goals API ──────────────────────────────
  app.post("/api/goals/:id/decompose", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const goalId = req.params.id;

      const [goalsRow] = await db
        .select({ data: schema.goals.data })
        .from(schema.goals)
        .where(eq(schema.goals.userId, userId))
        .limit(1);
      const goalsList = (goalsRow?.data as Array<{ id: string; title: string }>) || [];
      const goal = goalsList.find((g) => g.id === goalId);
      if (!goal) return res.status(404).json({ error: "Goal not found" });

      const { enqueueGoalDecomposition } = await import("./agent/goalDecomposer");
      const jobId = await enqueueGoalDecomposition(userId, { id: goal.id, title: goal.title });
      res.json({ ok: true, jobId, status: "queued" });
    } catch (err) {
      console.error("Error queuing goal decompose:", err);
      res.status(500).json({ error: "Failed to queue decomposition" });
    }
  });

  app.get("/api/goals/:id/tree", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const goalId = req.params.id;
      const [tree] = await db
        .select()
        .from(schema.goalTrees)
        .where(and(eq(schema.goalTrees.userId, userId), eq(schema.goalTrees.goalId, goalId)))
        .limit(1);
      if (!tree) return res.status(200).json({ hasTree: false });
      res.json({ hasTree: true, ...tree });
    } catch (err) {
      console.error("Error fetching goal tree:", err);
      res.status(500).json({ error: "Failed to fetch tree" });
    }
  });

  app.post("/api/agent-jobs", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { agentType, title, prompt, input } = req.body as {
        agentType?: string;
        title?: string;
        prompt?: string;
        input?: Record<string, unknown>;
      };
      const allowed = ["research", "writing", "planning", "email", "goal_decompose"] as const;
      if (!agentType || !allowed.includes(agentType as (typeof allowed)[number])) {
        return res.status(400).json({ error: `agentType must be one of ${allowed.join(", ")}` });
      }
      if (!title || !prompt) {
        return res.status(400).json({ error: "title and prompt are required" });
      }
      const { submitAgentJob } = await import("./agent/jobQueue");
      const jobId = await submitAgentJob({
        userId,
        agentType: agentType as (typeof allowed)[number],
        title,
        prompt,
        input: input || {},
      });
      res.json({ ok: true, jobId, status: "queued" });
    } catch (err) {
      console.error("Error submitting agent job:", err);
      res.status(500).json({ error: "Failed to submit job" });
    }
  });

  app.get("/api/agent-jobs", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
      const status = typeof req.query.status === "string" ? req.query.status : null;
      const where = status
        ? and(eq(schema.agentJobs.userId, userId), eq(schema.agentJobs.status, status))
        : eq(schema.agentJobs.userId, userId);
      const jobs = await db
        .select()
        .from(schema.agentJobs)
        .where(where)
        .orderBy(desc(schema.agentJobs.createdAt))
        .limit(limit);
      res.json(jobs);
    } catch (err) {
      console.error("Error listing agent jobs:", err);
      res.status(500).json({ error: "Failed to list jobs" });
    }
  });

  app.get("/api/deliverables", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const status = typeof req.query.status === "string" ? req.query.status : "pending_approval";
      const items = await db
        .select()
        .from(schema.deliverables)
        .where(and(eq(schema.deliverables.userId, userId), eq(schema.deliverables.status, status)))
        .orderBy(desc(schema.deliverables.createdAt))
        .limit(50);
      res.json(items);
    } catch (err) {
      console.error("Error listing deliverables:", err);
      res.status(500).json({ error: "Failed to list deliverables" });
    }
  });

  app.post("/api/deliverables/:id/approve", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = req.params.id;
      const [d] = await db
        .select()
        .from(schema.deliverables)
        .where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.userId, userId)))
        .limit(1);
      if (!d) return res.status(404).json({ error: "Deliverable not found" });
      if (d.status !== "pending_approval") {
        return res.status(400).json({ error: "Already actioned" });
      }

      let resultExtra: Record<string, unknown> = {};

      if (d.type === "email_draft") {
        // Push to Gmail Drafts
        const meta = (d.meta as { to?: string; subject?: string; emailBody?: string }) || {};
        const to = meta.to?.trim() || "";
        if (!to || !to.includes("@")) {
          return res.status(400).json({ error: "Email draft missing valid recipient" });
        }
        const tokens = await getValidGoogleTokens(userId);
        const token = tokens?.[0];
        if (!token) return res.status(400).json({ error: "Gmail not connected" });
        const { createGmailDraft } = await import("./integrations/gmail");
        const result = await createGmailDraft(token, to, meta.subject || d.title, meta.emailBody || d.body);
        resultExtra = { gmailDraftUrl: result.gmailUrl, gmailDraftId: result.draftId };
      } else {
        // research / document / plan → save into the user's Documents library
        await db.insert(userDocuments).values({
          userId,
          name: d.title.slice(0, 200),
          mimeType: "text/markdown",
          sizeBytes: Buffer.byteLength(d.body, "utf8"),
          status: "ready",
          extractedText: d.body,
          summary: d.summary || null,
        });
      }

      await db
        .update(schema.deliverables)
        .set({ status: "approved", actedAt: new Date() })
        .where(eq(schema.deliverables.id, id));
      // Lifecycle: complete → delivered (the user has accepted the work)
      if (d.jobId) {
        await db
          .update(schema.agentJobs)
          .set({ status: "delivered" })
          .where(and(eq(schema.agentJobs.id, d.jobId), eq(schema.agentJobs.status, "complete")));
      }
      res.json({ ok: true, ...resultExtra });
    } catch (err) {
      console.error("Error approving deliverable:", err);
      res.status(500).json({ error: "Failed to approve deliverable" });
    }
  });

  app.put("/api/deliverables/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = req.params.id;
      const { title, summary, body, meta } = req.body as {
        title?: unknown;
        summary?: unknown;
        body?: unknown;
        meta?: unknown;
      };
      const [existing] = await db
        .select()
        .from(schema.deliverables)
        .where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.userId, userId)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Deliverable not found" });
      if (existing.status !== "pending_approval") {
        return res.status(400).json({ error: "Only pending deliverables can be edited" });
      }
      const patch: Partial<typeof schema.deliverables.$inferInsert> = {};
      if (typeof title === "string" && title.trim().length > 0) patch.title = title.trim().slice(0, 300);
      if (typeof summary === "string") patch.summary = summary.slice(0, 1000);
      if (typeof body === "string" && body.trim().length > 0) patch.body = body.slice(0, 100_000);
      if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        patch.meta = { ...(existing.meta as Record<string, unknown>), ...(meta as Record<string, unknown>) };
      }
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No editable fields provided" });
      }
      const [updated] = await db
        .update(schema.deliverables)
        .set(patch)
        .where(eq(schema.deliverables.id, id))
        .returning();
      res.json({ ok: true, deliverable: updated });
    } catch (err) {
      console.error("Error editing deliverable:", err);
      res.status(500).json({ error: "Failed to edit deliverable" });
    }
  });

  app.post("/api/deliverables/:id/discard", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = req.params.id;
      const [d] = await db
        .select({ jobId: schema.deliverables.jobId })
        .from(schema.deliverables)
        .where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.userId, userId)))
        .limit(1);
      await db
        .update(schema.deliverables)
        .set({ status: "discarded", actedAt: new Date() })
        .where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.userId, userId)));
      if (d?.jobId) {
        // User has acted on it (rejected) — close the job lifecycle.
        await db
          .update(schema.agentJobs)
          .set({ status: "delivered" })
          .where(and(eq(schema.agentJobs.id, d.jobId), eq(schema.agentJobs.status, "complete")));
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("Error discarding deliverable:", err);
      res.status(500).json({ error: "Failed to discard deliverable" });
    }
  });

  app.get("/api/documents", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const docs = await db
        .select({
          id: userDocuments.id,
          name: userDocuments.name,
          mimeType: userDocuments.mimeType,
          sizeBytes: userDocuments.sizeBytes,
          status: userDocuments.status,
          summary: userDocuments.summary,
          uploadedAt: userDocuments.uploadedAt,
        })
        .from(userDocuments)
        .where(eq(userDocuments.userId, userId))
        .orderBy(desc(userDocuments.uploadedAt))
        .limit(MAX_DOCS_PER_USER);
      res.json({ documents: docs });
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.post("/api/documents", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { name, mimeType, data } = req.body;
      if (!name || !mimeType || !data) {
        return res.status(400).json({ error: "name, mimeType, and data are required" });
      }

      if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ error: `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}` });
      }

      const existing = await db
        .select({ id: userDocuments.id })
        .from(userDocuments)
        .where(eq(userDocuments.userId, userId));
      if (existing.length >= MAX_DOCS_PER_USER) {
        return res.status(400).json({ error: `Maximum ${MAX_DOCS_PER_USER} documents allowed. Delete some to upload more.` });
      }

      const buffer = Buffer.from(data, "base64");
      const sizeBytes = buffer.length;

      if (sizeBytes > 20 * 1024 * 1024) {
        return res.status(400).json({ error: "File too large. Maximum size is 20MB." });
      }

      const [inserted] = await db
        .insert(userDocuments)
        .values({ userId, name, mimeType, sizeBytes, status: "processing" })
        .returning();

      res.json({ document: inserted });

      processDocument(userId, inserted.id, name, mimeType, buffer).catch((err) => {
        console.error("[Docs] Background processing error:", err);
      });
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ error: "Failed to upload document" });
    }
  });

  app.delete("/api/documents/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { id } = req.params;
      await db
        .delete(userDocuments)
        .where(and(eq(userDocuments.id, id), eq(userDocuments.userId, userId)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  app.get("/api/chatgpt-import/status", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(schema.chatgptImports).where(eq(schema.chatgptImports.userId, userId));
      if (rows.length === 0) {
        return res.json({ imported: false });
      }
      const row = rows[0];
      res.json({ imported: true, importedAt: row.importedAt, memoriesAdded: row.memoriesAdded });
    } catch (error) {
      console.error("Error getting ChatGPT import status:", error);
      res.status(500).json({ error: "Failed to get import status" });
    }
  });

  app.post("/api/chatgpt-import", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { conversations } = req.body;
      if (!conversations || !Array.isArray(conversations) || conversations.length === 0) {
        return res.status(400).json({ error: "No conversations found. Please upload a valid ChatGPT export file." });
      }

      const recentConversations = conversations.slice(-150);

      const allTexts: string[] = [];
      for (const convo of recentConversations) {
        const lines: string[] = [];
        if (convo.title) lines.push(`[Conversation: ${convo.title}]`);

        if (convo.messages && Array.isArray(convo.messages)) {
          for (const msg of convo.messages) {
            if (msg.role && msg.text && typeof msg.text === 'string') {
              lines.push(`${msg.role}: ${msg.text.slice(0, 500)}`);
            }
          }
        } else if (convo.mapping && typeof convo.mapping === 'object') {
          const nodes = (Object.values(convo.mapping) as any[])
            .filter((n: any) => n?.message?.create_time)
            .sort((a: any, b: any) => (a.message.create_time || 0) - (b.message.create_time || 0));
          const unsortedNodes = (Object.values(convo.mapping) as any[])
            .filter((n: any) => !n?.message?.create_time);
          for (const node of [...nodes, ...unsortedNodes]) {
            const msg = node?.message;
            if (!msg || !msg.content?.parts) continue;
            const role = msg.author?.role;
            if (role !== 'user' && role !== 'assistant') continue;
            const text = msg.content.parts
              .filter((p: any) => typeof p === 'string')
              .join(' ')
              .trim();
            if (text.length > 0) {
              lines.push(`${role}: ${text.slice(0, 500)}`);
            }
          }
        }

        if (lines.length > 1) {
          allTexts.push(lines.join('\n'));
        }
      }

      if (allTexts.length === 0) {
        return res.status(400).json({ error: "No readable conversations found in the file." });
      }

      const existingRows = await db.select({ content: userMemories.content })
        .from(userMemories)
        .where(eq(userMemories.userId, userId));
      const existingMemories = existingRows.map(r => r.content);
      const normalizedExisting = new Set(existingMemories.map(normalizeMemoryContent));

      const batchSize = 10;
      let totalAdded = 0;
      const validCategories = ['personality', 'values', 'work_style', 'accomplishment', 'goal_discovered', 'relationship', 'pattern', 'preference', 'fact', 'goal', 'achievement'];

      for (let i = 0; i < allTexts.length; i += batchSize) {
        const batch = allTexts.slice(i, i + batchSize);
        const batchText = batch.join('\n\n---\n\n').slice(0, 12000);

        const currentMemories = [...existingMemories];
        const existingList = currentMemories.length > 0
          ? `\nExisting memories (DO NOT duplicate these):\n${currentMemories.map(m => `- ${m}`).join('\n')}`
          : '';

        const prompt = `You are extracting profile facts about a user from their ChatGPT conversation history.
Output a JSON array of { category, content } objects. Only extract facts that are specific, meaningful, and not already captured.
Focus on discovering: personality traits, values, work patterns, goals, relationships, preferences, and recurring behaviors.

Categories:
- personality — how they communicate, humor, energy, decision style
- values — what they care about deeply, what motivates them
- work_style — when/how they focus, work patterns, tools they use
- accomplishment — wins, achievements, proud moments mentioned
- goal_discovered — goals inferred from behavior (not just stated)
- relationship — key people in their life (family, teammates, boss)
- pattern — recurring behaviors, habits, tendencies
- preference — explicit preferences (meeting times, communication style, etc.)
- fact — general facts about the user
- goal — explicitly stated goals
- achievement — specific achievements mentioned
${existingList}

Conversations:
${batchText}

Return JSON: { "memories": [{"content": "string describing the fact", "category": "one of the categories above"}] }
Return { "memories": [] } if nothing new was learned. Do NOT repeat or rephrase existing memories.
Extract up to 8 memories per batch.`;

        try {
          const response = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            max_completion_tokens: 800,
          });

          const content = response.choices[0]?.message?.content || '{"memories":[]}';
          const parsed = JSON.parse(content);
          const rawMemories = Array.isArray(parsed.memories) ? parsed.memories : (Array.isArray(parsed) ? parsed : []);
          const newMemories = rawMemories.slice(0, 8);

          for (const mem of newMemories) {
            if (!mem.content || typeof mem.content !== 'string' || mem.content.trim().length === 0) continue;
            const normalized = normalizeMemoryContent(mem.content);
            if (normalizedExisting.has(normalized)) continue;
            const category = validCategories.includes(mem.category) ? mem.category : 'fact';
            await db.insert(userMemories).values({
              userId,
              content: mem.content.trim(),
              category,
            });
            normalizedExisting.add(normalized);
            existingMemories.push(mem.content.trim());
            totalAdded++;
            console.log(`[ChatGPT Import] Extracted: [${category}] ${mem.content.trim().slice(0, 60)}...`);
          }
        } catch (err) {
          console.error("[ChatGPT Import] Batch extraction error:", err);
        }
      }

      await db.insert(schema.chatgptImports)
        .values({ userId, importedAt: new Date(), memoriesAdded: totalAdded })
        .onConflictDoUpdate({
          target: [schema.chatgptImports.userId],
          set: { importedAt: new Date(), memoriesAdded: totalAdded },
        });

      console.log(`[ChatGPT Import] User ${userId}: imported ${totalAdded} memories from ${allTexts.length} conversations`);
      res.json({ imported: totalAdded, importedAt: new Date().toISOString() });
    } catch (error) {
      console.error("Error importing ChatGPT history:", error);
      res.status(500).json({ error: "Failed to import ChatGPT history" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
