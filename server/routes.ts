import { createHash } from 'crypto';
import { activeCoachRuns } from "./runRegistry";
import { buildGmailSourceId, gmailMessageIdExistsForUser } from "./utils/gmailSourceId";
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import { db } from "./db";
import { eq, and, desc, sql, gte, asc } from "drizzle-orm";
import * as schema from "@shared/schema";
import { userMemories, morningVoiceNotes, userPreferences, proactiveQuestionsSent, inboxItems, inboxRules, userDocuments, webchatInviteTokens } from "@shared/schema";
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
import { authRouter, authMiddleware, generateToken } from "./auth";
import { mobileAuthRouter } from "./mobileAuthRoutes";
import { registerDataRoutes } from "./dataRoutes";
import { registerTelegramRoutes } from "./telegramRoutes";
import { registerChannelRoutes } from "./channels/routes";
import { registerDiscordScheduleRoutes } from "./discord/schedulesRoutes";
import { registerAgentRoutes } from "./agent/agentRoutes";
import { registerCustomAgentRoutes } from "./agent/customAgentRoutes";
import { registerCodeProposalsRoutes } from "./agent/codeProposalsRoutes";
import { registerProjectRoutes } from "./projectRoutes";
import { registerDoctorRoutes } from "./doctor/doctorRoutes";
import { registerDownloadRoutes } from "./downloadRoutes";
import { registerVaultRoutes } from "./vaultRoutes";
import { isIntegrationOwner, claimIntegrationOwnership } from "./integrationOwner";
import { oauthRouter, oauthCallbackRouter } from "./oauthRoutes";
import { driveRouter } from "./driveRoutes";
import { getValidGoogleTokens, getValidGoogleToken, getValidMicrosoftToken, getUserTokens, getUserToken, getUserOAuthStatus } from "./userTokenStore";
import { tavilySearch, formatSearchResults } from "./integrations/search";
import { logInteraction, getRecentInteractions, formatInteractionTimeline } from "./interactionLog";
import { extractAndStore } from "./memory/extractor";
import { getSoul, getSoulPromptBlock, regenerateSoul, setManualOverride, setSoulContent } from "./memory/soul";
import { listPeople, deletePerson } from "./memory/people";
import { isUserPaired, sendDaemonOp, pingDaemon, getOpAuditLog, isDaemonActionAllowed, isAndroidDaemonActive, isDesktopDaemonActive, isAndroidDaemonActionAllowed, getRecentPhoneNotifications, getDaemonDeviceMeta, type AndroidDaemonAction } from "./daemon/bridge";
import type { DaemonAction, DaemonOp } from "./daemon/bridge";
import { telegramLinks, channelLinks } from "@shared/schema";
import { connectChannelTool } from "./agent/tools/connectChannel";
import { registerSubscriber, removeSubscriberIfCurrent } from "./webchatSSE";
import ytSearch from "yt-search";
import { buildYouTubeContextBlock } from "./utils/youtubeAutoFetch";
import { getPromptData, setPromptData } from "./coachSessionPromptCache";
import { markSoulStale } from "./memory/soul";

const _p = (v: string | string[]): string => Array.isArray(v) ? (v[0] ?? "") : v;

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

function buildCoachSystemPrompt(goals: any[], stats: any, history: any[], calendarEvents: any[] = [], lifeContext?: any, gmailItems?: any[], gmailConnected?: boolean, slackMessages?: any[], slackConnected?: boolean, commitmentsList?: any[], coachingMode?: string, memories?: { content: string; category: string }[], telegramMessages?: any[], telegramConnected?: boolean, morningNoteSummary?: string, documentsContext?: string, crossChannelContext?: string, soulBlock?: string, daemonSection?: string, emotionalStateBlock?: string, selfImprovementSection?: string, websiteContext?: string): string {
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
  const websiteSection = websiteContext || '';

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
${soulBlock && soulBlock.trim() ? soulBlock : memoriesSection}${emotionalStateBlock && emotionalStateBlock.trim() ? emotionalStateBlock : ''}

## User Profile
- Current streak: ${stats.streak || 0} days
- Best streak: ${stats.bestStreak || 0} days
- Total tasks completed: ${stats.totalCompleted || 0}
- Total XP earned: ${stats.xp || 0}
- Task completion rate (last 7 days): ${completionRate}% (${completedHistory.length} completed, ${skippedHistory.length} skipped)
${strugglingCategories.length > 0 ? `- Struggling most with: ${strugglingCategories.join(', ')}` : ''}${soulBlock && soulBlock.trim() ? '' : lifeContextSection}${websiteSection}${documentsSection}

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
- **Background job domain context**: When formulating a background job description from a follow-up message, include the full conversation topic (domain) in the prompt — not just the literal words of the latest message. The sub-agent has no access to conversation history. Example: if the conversation is about finding pets to adopt and the user says "find shelters in that area", the job prompt must be "find animal shelters in [city] — this is part of a search to adopt a cat". Always ask yourself what the conversation is actually about and include that domain explicitly.

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
- **image_generate** — Generate an image from a text prompt. Use model "dalle" (default, fast) for illustrations and concepts. Use model "flux" when the user asks for photorealistic or artistic images (requires INFSH_API_KEY).
- **generate_video** — Generate a short AI video (2-6 min). Always warn the user it will take a few minutes before calling. Requires INFSH_API_KEY. Use for animated scenes or explicit video requests only.
${selfImprovementSection ? `\n${selfImprovementSection}` : ''}
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
    ? existingTasks.map((t: { title: string; category?: string; priority?: string; completed?: boolean }) => `- ${t.title} (${t.category}, ${t.priority}${t.completed ? ', done' : ''})`).join('\n')
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

  const predictionContext = typeof body.predictionContext === 'string' ? body.predictionContext : null;

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
  const { soulSection: planSoul, patternSection: planPatterns, memorySection: planMemories, emotionalStateSection: planEmotionalState, vaultSection: planVault } =
    await buildAiContextSections(typeof userId === "string" ? userId : undefined, planSeed);

  const prompt = `You are Jarvis, an autonomous planning AI. Build a realistic, prioritized daily plan for this person.

Today is ${dayOfWeek}, ${dateStr}.${planSoul}${planPatterns}${planMemories}${planEmotionalState}${planVault}

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
${predictionContext ? `\n## Jarvis Foresight (pattern-based predictions)\n${predictionContext}\nScheduling rules based on these predictions:\n1. Place demanding/deep-focus tasks BEFORE the predicted dip hour and AT the predicted peak hour (if humanReadable mentions one).\n2. Move routine, low-effort, or administrative tasks INTO the predicted dip window.\n3. If a procrastination risk is flagged for a category, put a small "starter" version of that task first thing in the morning to build momentum.\n4. Assign a specific time (the "time" field in each task JSON) to at least one task that was explicitly positioned due to a Foresight prediction.\n` : ''}
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

Return JSON: { "reasoning": "2-3 sentences on your planning logic — always name at least one concrete data point (goal, email, brain dump item). If Jarvis Foresight predictions are present, explicitly call out a task that was timed around a prediction (e.g. 'Deep work block at 9 AM — your predicted peak energy window' or 'Admin tasks slotted at 3 PM to avoid your energy dip').", "tasks": [{ "title": "...", "category": "...", "priority": "...", "duration": 60, "time": "9:30 AM", "description": "..." }] }
Return ONLY the JSON object.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
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
      ? parsed.tasks.slice(0, 7).map((t: Record<string, unknown>) => ({
          title: String(t.title || 'Task'),
          category: validCategories.includes(t.category as string) ? String(t.category) : 'personal',
          priority: validPriorities.includes(t.priority as string) ? String(t.priority) : 'medium',
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

    // Fetch today's predictions and the user's energy peak hour to steer task
    // ordering toward energy windows.
    let predictionContext: string | null = null;
    try {
      const [{ getTodayPredictions }, { analysePatterns }] = await Promise.all([
        import("./intelligence/predictor"),
        import("./intelligence/pattern-analyser"),
      ]);
      const [preds, analysis] = await Promise.all([
        getTodayPredictions(userId, today, 55),
        analysePatterns(userId, 60),
      ]);

      if (preds.length > 0) {
        const peakHour = analysis.peakEnergyHour;
        const dipHour = analysis.dipEnergyHour;

        // Format a human-readable hour string (e.g. "10am", "3pm").
        const fmtHour = (h: number) =>
          h === 0 ? 'midnight' : h < 12 ? `${h}am` : h === 12 ? 'noon' : `${h - 12}pm`;

        // Prepend explicit peak/dip anchor lines so the LLM has definitive
        // hours to work with, regardless of what humanReadable contains.
        const anchorLines = [
          `- [peak_energy_window] Schedule deep/focus work at or before ${fmtHour(peakHour)} — this is your historically highest-energy hour.`,
          `- [low_energy_window] Avoid cognitively demanding tasks around ${fmtHour(dipHour)} — this is your historically lowest-energy hour.`,
        ].join('\n');

        const predLines = preds
          .slice(0, 4)
          .map((p) => {
            const predictedHour = p.targetDatetime
              ? new Date(p.targetDatetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              : null;
            const timeTag = predictedHour ? ` @ ${predictedHour}` : '';
            return `- [${p.predictionType}${timeTag}] ${p.humanReadable}${p.actionSuggestion ? ` → ${p.actionSuggestion}` : ''}`;
          })
          .join('\n');

        predictionContext = `${anchorLines}\n${predLines}`;
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
      predictionContext,
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

  // Health-check — unauthenticated, used by the UI to detect when the server has
  // come back up after a self-applied code-proposal restart.
  app.get("/api/ping", (_req: Request, res: Response) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // Owner-only: trigger a graceful backend restart (writes nothing to disk).
  // Used by the UI as a one-tap "Restart Backend" button when auto-restart is
  // not available. authMiddleware applied inline since this route is mounted
  // before the global app.use(authMiddleware).
  app.post("/api/admin/restart-backend", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const ok = await isIntegrationOwner(userId);
    if (!ok) return res.status(403).json({ error: "Forbidden" });
    res.json({ ok: true, message: "Backend is restarting…" });
    setTimeout(() => {
      console.log("[Admin] Graceful restart triggered by owner.");
      process.exit(0);
    }, 300);
  });

  // Public screenshot endpoint — IDs are random/opaque with 30-min TTL (no auth header needed by Image component)
  app.get("/api/daemon/screenshot/:id", (req: Request, res: Response) => {
    const entry = screenshotStore.get(_p(req.params.id));
    if (!entry || entry.expires < Date.now()) {
      return res.status(404).json({ error: 'Screenshot not found or expired' });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(entry.data);
  });

  /**
   * GET /go/voice-call — public deep-link redirect page
   *
   * Opened when the user taps the "🎙 Voice call" inline keyboard button in Telegram.
   * On mobile with the native app installed the OS intercepts jarvis://voice-realtime
   * and opens the app directly. If the app is not installed (or on desktop) the page
   * falls back to the HTTPS web version of the voice-realtime screen after 1.5 s.
   */
  app.get("/go/voice-call", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opening Jarvis Voice Call…</title>
  <style>
    body { margin: 0; display: flex; flex-direction: column; align-items: center;
           justify-content: center; min-height: 100vh; font-family: system-ui, sans-serif;
           background: #0F0F0F; color: #e5e5e5; text-align: center; padding: 1rem; }
    a { color: #6366F1; }
  </style>
</head>
<body>
  <p>Opening Jarvis voice call…</p>
  <p><a href="/voice-realtime">Tap here</a> if the app doesn't open automatically.</p>
  <script>
    // Attempt to open the native app via custom URL scheme.
    // If the app is installed, the OS will launch it; the page stays open but unfocused.
    // After 1.5 s we redirect to the web version as a fallback.
    try { window.location.href = 'jarvis://voice-realtime'; } catch (e) { /* ignore */ }
    setTimeout(function () { window.location.replace('/voice-realtime'); }, 1500);
  </script>
</body>
</html>`);
  });

  /**
   * POST /api/discord/interactions — public (Ed25519-verified, no JWT needed)
   *
   * Discord sends all slash-command interactions here. This must be registered
   * BEFORE authMiddleware because Discord requests do not carry a Bearer JWT.
   * Security is provided by Ed25519 signature verification instead.
   */
  app.post("/api/discord/interactions", async (req: Request, res: Response) => {
    try {
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      if (!publicKey) {
        console.warn("[DiscordInteractions] DISCORD_PUBLIC_KEY not set — rejecting request");
        return res.status(401).json({ error: "Interactions endpoint not configured" });
      }

      const signature = req.headers["x-signature-ed25519"] as string | undefined;
      const timestamp = req.headers["x-signature-timestamp"] as string | undefined;

      if (!signature || !timestamp) {
        return res.status(401).json({ error: "Missing Discord signature headers" });
      }

      const rawBody: Buffer = (req as any).rawBody;
      if (!rawBody) {
        return res.status(400).json({ error: "Missing raw body" });
      }

      // Replay-window check: reject interactions timestamped more than 5 minutes ago
      const tsSeconds = parseInt(timestamp, 10);
      if (isNaN(tsSeconds) || Math.abs(Date.now() / 1000 - tsSeconds) > 300) {
        return res.status(401).json({ error: "Request timestamp out of range" });
      }

      const { verifyDiscordSignature, handleInteraction } = await import("./discord/slashCommands");
      const valid = verifyDiscordSignature(publicKey, signature, timestamp, rawBody);
      if (!valid) {
        return res.status(401).json({ error: "Invalid request signature" });
      }

      const interaction = req.body;
      const response = await handleInteraction(interaction);
      return res.json(response);
    } catch (err) {
      console.error("[DiscordInteractions] Unhandled error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ── Admin: Skill Pack management (operator publish path) ─────────────────────
  // Auth: x-admin-secret header must match JARVIS_ADMIN_SECRET env var.
  // Mounted BEFORE authMiddleware so no user JWT is required — these endpoints
  // are called by the Jarvis team via machine-to-machine tooling, not individual
  // users. The static shared secret provides sufficient access control for this
  // low-volume internal API.

  function requireAdminSecret(req: Request, res: Response): boolean {
    const secret = process.env.JARVIS_ADMIN_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Admin secret not configured on this server." });
      return false;
    }
    if (req.headers["x-admin-secret"] !== secret) {
      res.status(401).json({ error: "Invalid admin secret." });
      return false;
    }
    return true;
  }

  /**
   * POST /api/admin/skills/publish
   * Publish a new or updated skill pack.
   *
   * Body:
   *   packId?        — if provided and exists, update that pack; otherwise create new
   *   name           — pack display name (required)
   *   instructions   — base instruction text (required)
   *   changeNote     — changelog note for this version (required)
   *   description?   — user-facing description (defaults to "" on create)
   *   isStoreVisible? — whether to show in the Skill Store (defaults to true on create)
   *   heartbeatRules? — JSON heartbeat rule config { disableDuringFocusBlocks, ... }
   *   toolGroups?    — JSON tool group config { boost: [...], suppress: [...] }
   *
   * Active sessions pick up the new instructions at their next session start —
   * mid-session injection is intentionally not supported to avoid instability.
   */
  app.post("/api/admin/skills/publish", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { publishSkillPack } = await import("./intelligence/behaviorStore");
      const body = req.body as {
        packId?: string;
        name?: string;
        instructions?: string;
        changeNote?: string;
        description?: string;
        isStoreVisible?: boolean;
        heartbeatRules?: schema.PackHeartbeatRules;
        toolGroups?: schema.PackToolGroups;
      };
      const { packId, name, instructions, changeNote, description, isStoreVisible, heartbeatRules, toolGroups } = body;
      if (!name || !instructions || !changeNote) {
        return res.status(400).json({ error: "name, instructions, and changeNote are required" });
      }
      const pack = await publishSkillPack({
        packId,
        name,
        instructions,
        changeNote,
        description,
        isStoreVisible,
        heartbeatRules,
        toolGroups,
      });
      console.log(`[Admin/Skills] published pack "${pack.name}" v${pack.version}`);
      res.json({ ok: true, pack });
    } catch (err) {
      console.error("[Admin/Skills] publish failed:", err);
      res.status(500).json({ error: "Failed to publish skill pack" });
    }
  });

  /**
   * GET /api/admin/skills
   * List all skill packs with their changelogs and per-user override counts.
   */
  app.get("/api/admin/skills", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { getAdminPackViews } = await import("./intelligence/behaviorStore");
      const packs = await getAdminPackViews();
      res.json({ packs });
    } catch (err) {
      console.error("[Admin/Skills] list failed:", err);
      res.status(500).json({ error: "Failed to list skill packs" });
    }
  });

  /**
   * GET /api/admin/provider-health
   * Smoke-tests ClaudeProvider and OpenAIProvider and returns a health report.
   * Useful for verifying API key configuration and SDK compatibility without
   * waiting for a real user turn to fail.
   */
  app.get("/api/admin/provider-health", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { runProviderHealthChecks } = await import("./agent/providers/healthCheck");
      const report = await runProviderHealthChecks();
      res.status(report.allOk ? 200 : 503).json(report);
    } catch (err) {
      console.error("[Admin/ProviderHealth] check threw:", err);
      res.status(500).json({ error: "Failed to run provider health checks" });
    }
  });

  /**
   * GET /api/admin/audio-transcription-stats
   * Returns a snapshot of Phase 3 audio transcription failure telemetry.
   * Shows attempt count, failure breakdown by error class, and the 50 most
   * recent failure events (video ID, error class, noCaptions flag, message).
   */
  app.get("/api/admin/audio-transcription-stats", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { getAudioTranscriptTelemetry } = await import("./lib/transcriptCache");
      res.json(getAudioTranscriptTelemetry());
    } catch (err) {
      console.error("[Admin/AudioStats] failed:", err);
      res.status(500).json({ error: "Failed to retrieve audio transcription telemetry" });
    }
  });

  /**
   * GET /api/transcript/diagnose?videoId=VIDEO_ID
   * Diagnoses the transcript pipeline for a specific video without spending quota.
   * Reports Gemini key status, Supadata key + native caption check, and yt-dlp availability.
   * Does NOT call Gemini (costs quota) — only checks key status and Supadata native captions.
   */
  app.get("/api/transcript/diagnose", authMiddleware, async (req: Request, res: Response) => {
    const videoId = String(req.query.videoId ?? "").trim();
    if (!videoId) {
      res.status(400).json({ error: "videoId query parameter is required" });
      return;
    }

    try {
      const { getYtdlpStatus, ensureYtdlpUpgraded } = await import("./lib/transcriptCache");

      // Check Gemini key status (do NOT call Gemini)
      const geminiDirectKey = process.env.GOOGLE_GEMINI_API_KEY;
      const geminiProxyKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
      const geminiKeyConfigured = !!(geminiDirectKey || geminiProxyKey);
      const geminiKeyType = geminiDirectKey ? "direct" : geminiProxyKey ? "proxy" : "none";
      const geminiResult = {
        keyConfigured: geminiKeyConfigured,
        keyType: geminiKeyType,
        note: geminiKeyConfigured
          ? geminiKeyType === "direct"
            ? "Will attempt transcription as Phase 0 (direct Google AI Studio key)"
            : "Will attempt transcription as Phase 0 (proxy key — may have quota limits)"
          : "Phase 0 skipped — no Gemini key configured. Set GOOGLE_GEMINI_API_KEY at https://aistudio.google.com/apikey",
      };

      // Check Supadata key + native captions
      const supadataKey = process.env.SUPADATA_API_KEY;
      let supadataResult: Record<string, unknown>;
      if (!supadataKey) {
        supadataResult = {
          keyConfigured: false,
          nativeCaptions: null,
          note: "Phase 0.5 skipped — SUPADATA_API_KEY not set. Get a free key at https://dash.supadata.ai",
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
              ? "Native captions found — fast, no credits. Will return immediately."
              : "Native captions empty — will use AI generation (mode=auto).";
          } else if (nativeRes.status === 404 || nativeRes.status === 400) {
            nativeCaptions = false;
            supadataNote = "No native captions — will use AI generation (mode=auto). Takes 5-10 min for long videos.";
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

      // Check yt-dlp availability
      await ensureYtdlpUpgraded().catch(() => null);
      const ytdlpStatus = getYtdlpStatus();
      const ytdlpResult = {
        available: ytdlpStatus.available,
        cmd: ytdlpStatus.cmd,
        reason: ytdlpStatus.available
          ? "yt-dlp is installed and responding"
          : "yt-dlp is not available — audio transcription and caption download will fail. Note: Replit datacenter IPs are blocked by YouTube, so yt-dlp success rates are very low even when installed.",
      };

      // Build recommendation
      const nativeCaptions = (supadataResult.nativeCaptions as boolean | null);
      let recommendation: string;
      if (geminiKeyConfigured && nativeCaptions !== false) {
        recommendation = "Gemini (Phase 0) is the fastest option. Supadata native captions also available.";
      } else if (geminiKeyConfigured) {
        recommendation = "Gemini (Phase 0) is the primary option. Supadata will use AI generation (mode=auto) — takes 5-10 min for long videos.";
      } else if (supadataKey && nativeCaptions === true) {
        recommendation = "Supadata native captions available — fast retrieval.";
      } else if (supadataKey) {
        recommendation = "Only Supadata AI generation is viable. Takes 5-10 min for long videos. Recommend enabling Gemini with GOOGLE_GEMINI_API_KEY.";
      } else {
        recommendation = "No cloud transcript methods available. Only local yt-dlp/Whisper pipeline (IP-blocked on Replit). Enable Gemini or Supadata.";
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

  /**
   * GET /api/admin/search-bar-registry
   * Lists all auto-discovered search-bar resource IDs stored in the DB.
   * Each entry shows the app package, the discovered resource_id, how many
   * distinct users have confirmed it (confidence), and the most recent update.
   * Use this to review candidates and decide which ones to promote to
   * APP_SEARCH_HINTS in daemonShellTool.ts for permanent, zero-heuristic lookups.
   *
   * Optional query params:
   *   ?minConfidence=N  — only return entries seen by >= N distinct users (default 1)
   */
  app.get("/api/admin/search-bar-registry", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    try {
      const { learnedResourceIds } = await import("./agent/tools/daemonShellTool");
      const minConfidence = Math.max(1, parseInt((req.query.minConfidence as string) ?? "1", 10) || 1);

      // Return all (app_package, resource_id) pairs that meet the confidence
      // threshold, grouped by both columns.  When multiple users discovered
      // different resource IDs for the same app, each variant appears as a
      // separate row — the admin can compare user_count to decide which one
      // to promote.  Ordered by confidence descending then recency descending.
      const rows = await db.execute(sql`
        SELECT
          app_package,
          discovered_resource_id,
          COUNT(DISTINCT user_id)::int AS user_count,
          MAX(updated_at)             AS last_seen
        FROM search_bar_locations
        WHERE discovered_resource_id IS NOT NULL
        GROUP BY app_package, discovered_resource_id
        HAVING COUNT(DISTINCT user_id) >= ${minConfidence}
        ORDER BY user_count DESC, last_seen DESC
      `);

      type RegistryRow = {
        app_package: string;
        discovered_resource_id: string;
        user_count: number;
        last_seen: string;
      };

      const entries = (rows.rows as RegistryRow[]).map((r) => ({
        appPackage: r.app_package,
        discoveredResourceId: r.discovered_resource_id,
        userCount: r.user_count,
        lastSeen: r.last_seen,
        inMemory: learnedResourceIds.get(r.app_package) === r.discovered_resource_id,
        promotionHint: `APP_SEARCH_HINTS["${r.app_package}"] = { resourceIds: ["${r.discovered_resource_id}"], extraKeywords: [] }`,
      }));

      res.json({
        total: entries.length,
        minConfidence,
        entries,
      });
    } catch (err) {
      console.error("[Admin/SearchBarRegistry] query failed:", err);
      res.status(500).json({ error: "Failed to fetch search-bar registry" });
    }
  });

  // GET /api/webchat/invite/redeem — no auth required; guest redeems invite token
  app.get("/api/webchat/invite/redeem", async (req: Request, res: Response) => {
    try {
      const { token } = req.query as { token?: string };
      if (!token) return res.status(400).json({ error: "token is required" });

      const [row] = await db
        .select()
        .from(webchatInviteTokens)
        .where(eq(webchatInviteTokens.token, token))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Invite link not found" });
      if (row.expiresAt < new Date()) {
        return res.status(410).json({ error: "This invite link has expired" });
      }

      const jwtToken = generateToken(row.userId);
      return res.json({ token: jwtToken, userId: row.userId });
    } catch (error) {
      console.error("Error redeeming webchat invite token:", error);
      return res.status(500).json({ error: "Failed to redeem invite token" });
    }
  });

  app.use(authMiddleware);

  // ── Webchat SSE push stream ─────────────────────────────────────────────────
  // The /chat page connects here so background job results can be pushed in
  // real time instead of accumulating in the in_app inbox.
  app.get("/api/webchat/events", (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(": connected\n\n");

    const token = registerSubscriber(userId, res);

    req.on("close", () => {
      removeSubscriberIfCurrent(userId, token);
    });
  });

  app.use("/api/oauth", oauthRouter);

  registerDataRoutes(app);
  registerTelegramRoutes(app);
  registerChannelRoutes(app);
  registerDiscordScheduleRoutes(app);
  registerAgentRoutes(app);
  registerCustomAgentRoutes(app);
  registerCodeProposalsRoutes(app);
  registerProjectRoutes(app);
  registerDoctorRoutes(app);
  registerVaultRoutes(app);
  app.use("/api/drive", driveRouter);

  // ── Jarvis Ego — Dashboard API ─────────────────────────────────────────────

  app.get("/api/ego/dashboard", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { analyseEgo, getISOWeekMonday } = await import("./intelligence/ego");
      const weekOf = getISOWeekMonday(new Date());
      const analysis = await analyseEgo(userId, weekOf);

      const latestReport = await db
        .select()
        .from(schema.egoWeeklyReports)
        .where(eq(schema.egoWeeklyReports.userId, userId))
        .orderBy(desc(schema.egoWeeklyReports.createdAt))
        .limit(1);

      res.json({
        analysis,
        latestReport: latestReport[0] ?? null,
      });
    } catch (err) {
      console.error("[Ego] dashboard failed:", err);
      res.status(500).json({ error: "Failed to load ego dashboard" });
    }
  });

  app.get("/api/ego/reports", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const reports = await db
        .select()
        .from(schema.egoWeeklyReports)
        .where(eq(schema.egoWeeklyReports.userId, userId))
        .orderBy(desc(schema.egoWeeklyReports.createdAt))
        .limit(12);

      res.json({ reports });
    } catch (err) {
      console.error("[Ego] reports failed:", err);
      res.status(500).json({ error: "Failed to load reports" });
    }
  });

  app.post("/api/ego/trigger", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      // Guard: only allow manual trigger in development, or when ?force=true is
      // explicitly passed. This prevents partial-week reports being locked in
      // production via early triggering (the scheduler handles Sunday 18:00 UTC).
      const isDev = process.env.NODE_ENV !== "production";
      const forceOverride = req.query.force === "true";
      if (!isDev && !forceOverride) {
        return res.status(403).json({ error: "Manual trigger not available in production (pass ?force=true to override)" });
      }

      const { runEgoForUser, getISOWeekMonday } = await import("./intelligence/ego");
      const weekOf = getISOWeekMonday(new Date());
      const delivered = await runEgoForUser(userId, weekOf);
      res.json({ ok: true, delivered, weekOf });
    } catch (err) {
      console.error("[Ego] trigger failed:", err);
      res.status(500).json({ error: "Failed to trigger ego report" });
    }
  });

  app.get("/api/discord/status", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const links = await db.select().from(channelLinks)
        .where(and(eq(channelLinks.userId, userId), eq(channelLinks.channel, 'discord')));
      const link = links[0];
      const meta = link?.metadata as { discordUsername?: string } | undefined;
      res.json({
        connected: links.length > 0,
        discordUsername: meta?.discordUsername ?? null,
      });
    } catch (error) {
      console.error("Error getting Discord status:", error);
      res.status(500).json({ error: "Failed to get Discord status" });
    }
  });

  app.post("/api/discord/link", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { code } = req.body as { code?: string };
      if (!code || code.trim().length === 0) {
        return res.status(400).json({ error: "Pairing code is required." });
      }
      const { completePairing } = await import("./discord/manager");
      const result = await completePairing(userId, code.trim().toUpperCase());
      if (!result.ok) {
        return res.status(400).json({ error: result.error ?? "Pairing failed." });
      }
      res.json({ ok: true, discordUsername: result.discordUsername });
    } catch (error) {
      console.error("Error completing Discord pairing:", error);
      res.status(500).json({ error: "Failed to complete Discord pairing." });
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
        userId: (req as any).userId,
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
      const result = await unblockTask({ taskTitle, taskDescription, blockerType, skipDays: skipDays || 1, userId: (req as any).userId });
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

      // Auto-save to Google Drive (non-fatal, fire-and-forget).
      const userId = (req as any).userId as string | undefined;
      if (userId && result && result.tasks.length > 0) {
        (async () => {
          try {
            const { getUserDriveSettings } = await import('./driveRoutes');
            const { createDriveTextFile } = await import('./integrations/googleDrive');
            const drive = await getUserDriveSettings(userId);
            if (drive.enabled && drive.autoSavePlans && drive.accessToken) {
              const today = new Date().toISOString().slice(0, 10);
              const lines: string[] = [`# Daily Plan — ${today}`, '', '## Tasks', ''];
              for (const t of result.tasks) {
                const dur = t.duration ? ` (${t.duration} min)` : '';
                const tm = t.time ? ` @ ${t.time}` : '';
                lines.push(`⬜ **${t.title}**${tm}${dur}`);
                if (t.description) lines.push(`   ${t.description}`);
              }
              if (result.reasoning) lines.unshift(`> ${result.reasoning}`, '', lines.shift()!);
              await createDriveTextFile(
                drive.accessToken,
                `Daily Plan — ${today}`,
                lines.join('\n'),
                { convertToDoc: true, folderId: drive.folderId || undefined }
              );
              console.log(`[Route] Drive auto-save (build-plan) for user ${userId}`);
            }
          } catch (driveErr) {
            console.error('[Route] Drive auto-save (build-plan) failed:', driveErr);
          }
        })();
      }
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
        description: "Fetch the COMPLETE transcript/captions of a YouTube video server-side — returns the full text with no truncation. Use this INSTEAD of navigating YouTube's transcript UI on the phone.\n\nINTERNAL PIPELINE — this tool automatically tries multiple methods in order:\n  Phase 0:   Gemini multimodal — feeds the video URL directly to Gemini AI\n  Phase 0.5: Supadata — a cloud transcript API (supadata.ai) that bypasses YouTube's IP blocks. Uses mode=auto: tries native captions first, then AI-generates a transcript if no captions exist. This costs Supadata credits for AI generation.\n  Phase 1-4: YouTube InnerTube API, yt-dlp subtitles, timedtext, youtube-transcript library\n  Phase 5:   Whisper audio transcription (downloads audio via yt-dlp, then transcribes)\n  Phase 6:   Tavily web search fallback (last resort — summaries, not a real transcript)\n\nThe 'via X' label in the result (e.g. 'via Supadata', 'via YouTube captions', 'via Whisper (audio)') tells you which phase succeeded.",
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
        name: "fetch_transcript_gemini",
        description: "Fetch a YouTube transcript by feeding the video URL directly to Gemini's multimodal API (gemini-2.5-flash/pro). No captions required — Gemini transcribes the audio from Google's own infrastructure. Use when the video has no captions, or when the user explicitly asks to use Gemini. Requires GOOGLE_GEMINI_API_KEY to be configured.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
          },
          required: ["videoId"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_transcript_supadata",
        description: "Fetch a YouTube transcript via the Supadata API (supadata.ai) using mode=auto. Tries YouTube's native captions first; if none exist, AI-generates a transcript (uses Supadata credits). Use when the user explicitly asks for Supadata, or when native captions are unavailable. Requires SUPADATA_API_KEY.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
          },
          required: ["videoId"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_transcript_audio",
        description: "Fetch a YouTube transcript by downloading the audio via yt-dlp and transcribing it with OpenAI Whisper. Works even when no captions exist and Gemini/Supadata are unavailable. Use when the user explicitly asks for audio/Whisper transcription. Note: slow for long videos (may take several minutes). Requires yt-dlp to be installed.",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
          },
          required: ["videoId"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "fetch_transcript_captions",
        description: "Fetch a YouTube transcript using only native YouTube captions — no AI, no credits charged. Tries InnerTube, yt-dlp subtitles, timedtext, and the youtube-transcript library. Fast, but only works if the video actually has captions. Use when the user explicitly wants captions-only (no AI generation).",
        parameters: {
          type: "object",
          properties: {
            videoId: { type: "string", description: "YouTube video ID (11 characters, e.g. 'dQw4w9WgXcQ') or full YouTube URL." },
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
    {
      type: "function" as const,
      function: {
        name: "image_generate",
        description:
          "Generate an image from a text prompt using GPT Image and display it inline in the chat. " +
          "Use for concept illustrations, motivational visuals, meal plan photos, mind maps, or any explicit image request. " +
          "Do NOT call this for text-only answers — only when the user explicitly asks for an image or a visual would meaningfully enhance the response.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "A detailed description of the image to generate. Include style, content, mood, and any relevant details.",
            },
            size: {
              type: "string",
              enum: ["square", "landscape", "portrait"],
              description: "Image aspect ratio: square (1:1, default), landscape (16:9), portrait (9:16).",
            },
            caption: {
              type: "string",
              description: "Optional short caption displayed below the image in chat (1-2 sentences max).",
            },
          },
          required: ["prompt"],
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
    userId: string,
    signal?: AbortSignal
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
          const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []) as Array<{ completed: boolean; title: string; notes?: string; id: string }>;
          const matched = tasks.find((t) => !t.completed && fuzzyMatch(args.taskTitle, t.title));
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
            // Close the ego action outcome loop: resolve the specific task_suggested
            // and prediction_made actions tied to this task so only the intended
            // action rows are updated (not all pending rows of that type).
            try {
              const { resolveActionByTaskId } = await import("./intelligence/actionLog");
              await resolveActionByTaskId(userId, "task_suggested", matched.id, "completed");
              await resolveActionByTaskId(userId, "prediction_made", matched.id, "completed");
            } catch {}
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
          const isAndroid = isAndroidDaemonActive(userId);
          const googleEmail = oauthStatus?.google?.email || (oauthStatus?.google?.accounts?.[0]?.email) || 'unknown';
          const msEmail = oauthStatus?.microsoft?.email || (oauthStatus?.microsoft?.accounts?.[0]?.email) || 'unknown';
          const slackConnectedCheck = (oauthStatus as any)?.slack?.connected ?? false;
          const isDesktop = isDesktopDaemonActive(userId);
          const daemonParts: string[] = [];
          if (isDesktop) daemonParts.push(`Desktop Daemon: ✓ online — use shell, notify, file_read, file_write, file_list actions.`);
          if (isAndroid) daemonParts.push(`Android Device Daemon: ✓ online — use android_open_app, android_browse, android_screenshot, android_read_screen, android_tap, android_type, android_swipe, android_press_key, android_file_list, android_file_read, android_notifications_list, notify, android_return_to_jarvis. After completing a multi-step phone task: (1) call notify (title:'Jarvis ✓', body: one-line summary), then (2) call android_return_to_jarvis to navigate the phone back to the Jarvis chat. If a tool returns result:error, stop and report the error immediately — do NOT fabricate success. After android_open_app or android_browse succeeds, ALWAYS call android_read_screen before describing screen content. For app searches use deep links: YouTube='vnd.youtube://results?search_query=QUERY', Maps='geo:0,0?q=QUERY', Spotify='spotify:search:QUERY'.`);
          const daemonLabel = daemonOnline
            ? daemonParts.join(" | ")
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
          const isAndroidDaemon = isAndroidDaemonActive(userId);
          const androidActions = ['android_open_app', 'android_browse', 'android_return_to_jarvis', 'android_screenshot', 'android_read_screen', 'android_tap', 'android_type', 'android_swipe', 'android_press_key', 'android_file_list', 'android_file_read', 'android_notifications_list', 'android_wait'];
          const desktopActions = ['shell', 'file_read', 'file_write', 'file_list'];

          let op: DaemonOp;
          if (action === 'notify') {
            // Platform-neutral: routes to desktop daemon if connected, else android fallback.
            // sendDaemonOp handles the routing — no daemon-type guard needed here.
            op = { type: 'notify', title: String(args.title || 'Jarvis'), body: String(args.body || '') };
          } else if (androidActions.includes(action)) {
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
            if (!isDesktopDaemonActive(userId)) return { result: 'error', label: 'Desktop daemon required', detail: `Action '${action}' requires the Desktop Daemon. Connect it from Profile → Connected Channels.` };
            if (!(await isDaemonActionAllowed(userId, action as DaemonAction))) {
              return { result: 'error', label: `Action '${action}' not permitted`, detail: `Enable '${action}' in Profile → Connected Channels → Desktop Daemon → Permissions.` };
            }
            if (action === 'shell') {
              if (!args.cmd) return { result: 'error', label: 'cmd required', detail: 'Provide cmd for shell action.' };
              op = { type: 'shell', cmd: String(args.cmd), cwd: args.cwd ? String(args.cwd) : undefined };
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
          const { fetchTranscriptCached, extractVideoId, isPlaylistUrl } = await import('./lib/transcriptCache');
          if (isPlaylistUrl(rawInput)) {
            return { result: 'error', label: 'Playlist URL not supported', detail: 'This looks like a YouTube playlist URL. Provide a single video URL or video ID instead.' };
          }
          const resolvedId = extractVideoId(rawInput) ?? rawInput.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 11);
          try {
            const { segments, source, asyncJobPending, jobId, phaseErrors, supadataTimedOut } = await fetchTranscriptCached(resolvedId, { userId });

            if (asyncJobPending) {
              return {
                result: 'pending',
                label: 'Transcript generation started',
                detail: `Supadata started AI transcript generation for video '${resolvedId}' (job ${jobId}). This video has no native captions — AI generation takes 5-10 minutes for long videos. Try fetching this video again in a few minutes; the result will be ready then.`,
              };
            }

            // Success takes priority over any timeout/error flags — if segments arrived, use them
            if (segments && segments.length > 0) {
              const fullText = segments.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim();
              const sourceNote = source && source !== 'unknown' ? ` [source: ${source}]` : '';
              return {
                result: 'success',
                label: 'Transcript fetched',
                detail: `Video ID: ${resolvedId}${sourceNote}\nTranscript (${segments.length} segments, ${fullText.length} chars total):\n\n${fullText}`,
              };
            }

            if (supadataTimedOut) {
              return {
                result: 'error',
                label: 'Transcript generation timed out',
                detail: `Supadata started AI generation for video '${resolvedId}' but it took longer than 10 minutes. The credits have been used. Please try again — the transcript may now be cached on Supadata's servers.${phaseErrors?.supadata ? ` Error: ${phaseErrors.supadata}` : ''}`,
              };
            }

            if (!segments || segments.length === 0) {
              const errorParts: string[] = [];
              if (phaseErrors?.gemini) errorParts.push(`Gemini error: ${phaseErrors.gemini}`);
              if (phaseErrors?.supadata) errorParts.push(`Supadata error: ${phaseErrors.supadata}`);
              const geminiKey = process.env.GOOGLE_GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
              const supadataKey = process.env.SUPADATA_API_KEY;
              let detail = `Could not retrieve transcript for video '${resolvedId}'.`;
              if (errorParts.length > 0) {
                detail += ` ${errorParts.join('. ')}. This video likely has no native captions. Try again — Supadata may need more time for AI generation.`;
              } else if (!geminiKey && !supadataKey) {
                detail += ' No cloud transcript services are configured (GOOGLE_GEMINI_API_KEY and SUPADATA_API_KEY are both unset). This video likely has no native captions, and the server IP is blocked by YouTube for direct downloads.';
              } else {
                detail += ' This video likely has no native captions. Gemini and/or Supadata were attempted — check server logs for the exact error. If Supadata returned a job ID, try again in a few minutes.';
              }
              return { result: 'error', label: 'No transcript found', detail };
            }

            // Fallthrough safety — should not reach here (segments > 0 handled above)
            return { result: 'error', label: 'No transcript found', detail: `No transcript found for video '${resolvedId}'.` };
          } catch (err: any) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[fetch_youtube_transcript] Error for ${resolvedId}:`, msg);

            if (msg.startsWith('SUPADATA_JOB_PENDING:')) {
              const jobId = msg.replace('SUPADATA_JOB_PENDING:', '');
              return {
                result: 'pending',
                label: 'Transcript generation started',
                detail: `Supadata started AI transcript generation for video '${resolvedId}' (job ${jobId}). This video has no native captions — AI generation takes 5-10 minutes for long videos. Try fetching this video again in a few minutes.`,
              };
            }
            if (msg.toLowerCase().includes('timed out after') && msg.toLowerCase().includes('supadata')) {
              return {
                result: 'error',
                label: 'Transcript generation timed out',
                detail: `Supadata started AI generation for this video but it took longer than 10 minutes. The credits have been used. Please try again — the transcript may now be cached on Supadata's servers. Error: ${msg}`,
              };
            }
            if (msg.includes('LOGIN_REQUIRED') || msg.includes('private video')) {
              return { result: 'error', label: 'Video unavailable', detail: `This video is private or requires login. Cannot fetch transcript for '${resolvedId}'.` };
            }
            if (msg.includes('CONTENT_RESTRICTED') || msg.includes('age-restricted')) {
              return { result: 'error', label: 'Content restricted', detail: `This video is age-restricted or region-blocked. Cannot fetch transcript for '${resolvedId}'.` };
            }
            if (msg.includes('disabled') || msg.includes('Transcript is disabled')) {
              return { result: 'error', label: 'Transcript disabled', detail: `Transcripts are disabled for video '${resolvedId}'. Try a different video.` };
            }
            return {
              result: 'error',
              label: 'Transcript fetch failed',
              detail: `Could not retrieve transcript for '${resolvedId}'. Error: ${msg}. If this video has no native captions, try again in a few minutes — Supadata may need more time for AI generation.`,
            };
          }
        }
        case 'fetch_transcript_gemini': {
          const rawInput = String(args.videoId || '').trim();
          if (!rawInput) return { result: 'error', label: 'videoId required', detail: 'Provide a YouTube video ID or URL.' };
          const { fetchTranscriptViaGemini, isGeminiTranscriptAvailable, isTranscriptRefusal } = await import('./lib/geminiTranscript');
          if (!process.env.GOOGLE_GEMINI_API_KEY || !isGeminiTranscriptAvailable()) {
            return { result: 'error', label: 'Gemini unavailable', detail: 'GOOGLE_GEMINI_API_KEY is not configured — Gemini transcript unavailable. Add a direct Google AI Studio key (free at https://aistudio.google.com/apikey) to enable this tool.' };
          }
          const { extractVideoId } = await import('./lib/transcriptCache');
          const videoId = extractVideoId(rawInput) ?? rawInput;
          const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
          try {
            const text = await fetchTranscriptViaGemini(videoUrl);
            return {
              result: 'success',
              label: 'Gemini transcript fetched',
              detail: `[Gemini transcript for ${videoId} — ${text.length} chars]\n${text}`,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (isTranscriptRefusal(msg) || msg.toLowerCase().includes('refusal') || msg.toLowerCase().includes('declined')) {
              return { result: 'error', label: 'Gemini refused', detail: `Gemini declined to transcribe this video (likely copyright-protected content). ${msg}` };
            }
            return { result: 'error', label: 'Gemini transcript failed', detail: msg };
          }
        }
        case 'fetch_transcript_supadata': {
          const rawInput = String(args.videoId || '').trim();
          if (!rawInput) return { result: 'error', label: 'videoId required', detail: 'Provide a YouTube video ID or URL.' };
          const { isSupadataAvailable, fetchTranscriptViaSupadata } = await import('./lib/supadataTranscript');
          if (!isSupadataAvailable()) {
            return { result: 'error', label: 'Supadata unavailable', detail: 'SUPADATA_API_KEY is not configured — Supadata transcript unavailable.' };
          }
          const { extractVideoId } = await import('./lib/transcriptCache');
          const videoId = extractVideoId(rawInput) ?? rawInput;
          try {
            const segs = await fetchTranscriptViaSupadata(videoId, { signal });
            if (!segs || segs.length === 0) {
              return { result: 'error', label: 'No transcript returned', detail: `Supadata returned an empty transcript for video '${videoId}'. The video may have no speech content, or AI generation produced no output.` };
            }
            const text = segs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
            const creditsNote = '\n\nNote: Supadata uses mode=auto — if no native YouTube captions were found, AI generation was used (costs Supadata credits).';
            return {
              result: 'success',
              label: 'Supadata transcript fetched',
              detail: `[Supadata transcript for ${videoId} — ${text.length} chars]\n${text}${creditsNote}`,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { result: 'error', label: 'Supadata transcript failed', detail: msg };
          }
        }
        case 'fetch_transcript_audio': {
          const rawInput = String(args.videoId || '').trim();
          if (!rawInput) return { result: 'error', label: 'videoId required', detail: 'Provide a YouTube video ID or URL.' };
          const { getYtdlpStatus, fetchTranscriptCached, extractVideoId, ensureYtdlpUpgraded } = await import('./lib/transcriptCache');
          await ensureYtdlpUpgraded();
          const ytdlp = getYtdlpStatus();
          if (!ytdlp.available) {
            return { result: 'error', label: 'yt-dlp unavailable', detail: 'yt-dlp is not installed on this server — audio transcription unavailable.' };
          }
          const videoId = extractVideoId(rawInput) ?? rawInput;
          try {
            const { segments, source } = await fetchTranscriptCached(videoId, { audioOnly: true, bypassCache: true, signal });
            if (segments.length === 0) {
              return { result: 'error', label: 'Audio transcription failed', detail: 'Audio transcription returned no segments — the video may be too long, blocked, or Whisper is unavailable.' };
            }
            const text = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
            return {
              result: 'success',
              label: 'Audio transcript fetched',
              detail: `[Audio (Whisper) transcript for ${videoId} — ${text.length} chars]\n${text}`,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { result: 'error', label: 'Audio transcript failed', detail: msg };
          }
        }
        case 'fetch_transcript_captions': {
          const rawInput = String(args.videoId || '').trim();
          if (!rawInput) return { result: 'error', label: 'videoId required', detail: 'Provide a YouTube video ID or URL.' };
          const { fetchTranscriptCached, extractVideoId } = await import('./lib/transcriptCache');
          const videoId = extractVideoId(rawInput) ?? rawInput;
          const CAPTION_SOURCES = ['innertube', 'yt-dlp', 'timedtext', 'youtube-transcript'];
          const isCaptionSource = (s: string) => CAPTION_SOURCES.some(cs => s.startsWith(cs));
          try {
            const { segments, source } = await fetchTranscriptCached(videoId, { captionsOnly: true, bypassCache: true, signal });
            if (segments.length === 0 || !isCaptionSource(source)) {
              return { result: 'error', label: 'No captions found', detail: 'No captions available for this video — try fetch_transcript_gemini or fetch_transcript_supadata for AI-generated transcript.' };
            }
            const text = segments.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
            return {
              result: 'success',
              label: 'Captions fetched',
              detail: `[Captions transcript for ${videoId} via ${source} — ${text.length} chars]\n${text}`,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.toLowerCase().includes('no captions') || (msg.toLowerCase().includes('transcript') && msg.toLowerCase().includes('not available'))) {
              return { result: 'error', label: 'No captions found', detail: 'No captions available for this video — try fetch_transcript_gemini or fetch_transcript_supadata for AI-generated transcript.' };
            }
            return { result: 'error', label: 'Captions fetch failed', detail: msg };
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
        case 'image_generate': {
          const prompt = String(args.prompt || '').trim();
          if (!prompt) return { result: 'error', label: 'prompt required', detail: 'Provide a prompt for image_generate.' };
          const caption = args.caption ? String(args.caption).trim() : undefined;
          // gpt-image-1 supported sizes (not DALL-E 3 sizes)
          const sizeMap: Record<string, '1024x1024' | '1536x1024' | '1024x1536'> = {
            square: '1024x1024',
            landscape: '1536x1024',
            portrait: '1024x1536',
          };
          const preferredSize = sizeMap[String(args.size || 'square')] ?? '1024x1024';
          try {
            const { default: OpenAI } = await import('openai');
            const imgClient = new OpenAI({
              apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
              baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
            });
            let b64: string | undefined;
            try {
              const response = await imgClient.images.generate({
                model: 'gpt-image-1',
                prompt,
                n: 1,
                size: preferredSize,
              });
              b64 = response.data?.[0]?.b64_json;
            } catch (sizeErr) {
              // If the preferred size fails, fall back to square 1024x1024
              if (preferredSize !== '1024x1024') {
                console.warn('[image_generate] preferred size failed, retrying with 1024x1024:', sizeErr);
                const fallback = await imgClient.images.generate({
                  model: 'gpt-image-1',
                  prompt,
                  n: 1,
                  size: '1024x1024',
                });
                b64 = fallback.data?.[0]?.b64_json;
              } else {
                throw sizeErr;
              }
            }
            if (!b64) throw new Error('No image data returned from gpt-image-1');
            const imageUrl = `data:image/png;base64,${b64}`;
            return { result: 'success', label: 'Image generated', detail: JSON.stringify({ imageUrl, caption }) };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[image_generate] gpt-image-1 error in routes:', err);
            return { result: 'error', label: 'Image generation failed', detail: msg };
          }
        }
        default:
          return { result: 'error', label: 'Unknown action', detail: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      // Rethrow AbortError so the route-level abort handler can terminate the run cleanly
      if (error instanceof Error && (error.name === 'AbortError' || error.message?.includes('aborted'))) {
        throw error;
      }
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

  /**
   * Detect praise/correction/preference signals in the latest exchange and
   * feed them into the Behaviour-to-Skill pipeline (best-effort, never throws).
   */
  function detectAndRecordBehaviorSignals(userId: string | undefined, messages: any[]): void {
    if (!userId || messages.length === 0) return;
    try {
      const { detectBehaviorSignals } = require("./intelligence/pattern-analyser");
      const { recordSkillSignal } = require("./intelligence/skillWriter");
      const signals: Array<{ patternId: string; example: string }> = detectBehaviorSignals(messages);
      for (const sig of signals) {
        recordSkillSignal(userId, sig.patternId, sig.example).catch(() => {});
      }
    } catch {
      // best-effort — never block the response
    }
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
          model: "gpt-4o-mini",
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
    let userId: string | null | undefined;
    let cleanupRun: () => void = () => {};
    let stopKeepalive: () => void = () => {};
    try {
      const { messages, goals, stats, history, calendarEvents, lifeContext, gmailItems, gmailConnected, slackMessages, slackConnected, coachingMode, telegramMessages, telegramConnected, sdkSessionId: incomingAppSessionId, originChannel: rawOriginChannel } = req.body;
      const originChannel: string = (typeof rawOriginChannel === "string" && rawOriginChannel.trim()) ? rawOriginChannel.trim().toLowerCase() : "appchat";
      userId = req.userId;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "messages array is required" });
      }

      // ── Session-aware system-prompt data ──────────────────────────────────────
      // On warm (resumed) sessions skip the expensive per-turn DB/API fetches
      // and serve data from the in-process prompt cache instead.  On cold starts
      // (or cache misses) the data is fetched normally and stored in the cache
      // once the session ID is known (see the initSession block further below).
      const cachedPromptData = getPromptData(userId ?? undefined, incomingAppSessionId ?? undefined);
      if (incomingAppSessionId) {
        console.log(`[CoachPromptCache] userId=${userId} session=${incomingAppSessionId} ${cachedPromptData ? 'HIT' : 'MISS'}`);
      }

      let resolvedGmailConnected: boolean;
      let resolvedGmailItems: any[];
      let resolvedCalendarEvents: any[];
      let userCommitments: any[];
      let memories: { content: string; category: string }[];
      let morningNoteSummary: string;
      let documentsContext: string;
      let proactiveQuestionContext: string;
      let crossChannelContext: string;
      let soulBlock: string;
      let emotionalStateBlock: string;
      let websiteContext: string;

      if (cachedPromptData) {
        // Warm session — use cached values, skip all DB/API round-trips.
        ({ resolvedGmailConnected, resolvedGmailItems, calendarEvents: resolvedCalendarEvents,
           userCommitments, memories, morningNoteSummary, documentsContext,
           proactiveQuestionContext, crossChannelContext, soulBlock,
           emotionalStateBlock, websiteContext } = cachedPromptData);
      } else {
        // Cold start or cache miss — fetch everything fresh.
        resolvedGmailConnected = gmailConnected ?? false;
        resolvedGmailItems = gmailItems || [];
        resolvedCalendarEvents = calendarEvents || [];

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

        userCommitments = [];
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

        memories = [];
        morningNoteSummary = '';
        documentsContext = '';
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

        proactiveQuestionContext = '';
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

        crossChannelContext = '';
        if (userId) {
          try {
            const recentInteractions = await getRecentInteractions(userId, 20);
            crossChannelContext = formatInteractionTimeline(recentInteractions);
          } catch {}
        }

        soulBlock = await getSoulPromptBlock(userId ?? "");

        emotionalStateBlock = '';
        if (userId) {
          try {
            const { getEmotionalState, buildEmotionalStatePromptBlock } = await import("./intelligence/emotional-state");
            const emotionalState = await getEmotionalState(userId);
            if (emotionalState) emotionalStateBlock = buildEmotionalStatePromptBlock(emotionalState);
          } catch {}
        }

        websiteContext = '';
        if (userId) {
          try {
            const { getWebsiteCrawlSummaryBlock } = await import("./websiteCrawler");
            websiteContext = await getWebsiteCrawlSummaryBlock(userId);
          } catch {}
        }

        // Re-seed cache for resumed sessions that suffered a cache miss (e.g.
        // after a server restart) so subsequent turns skip the fetch cost.
        if (userId && incomingAppSessionId) {
          setPromptData(userId, incomingAppSessionId, {
            resolvedGmailConnected, resolvedGmailItems, calendarEvents: resolvedCalendarEvents,
            userCommitments, memories, morningNoteSummary, documentsContext,
            proactiveQuestionContext, crossChannelContext,
            soulBlock, emotionalStateBlock, websiteContext,
          });
        }
      }

      const daemonPaired = userId ? isUserPaired(userId) : false;
      const androidActive = userId ? isAndroidDaemonActive(userId) : false;
      const daemonDeviceMeta = daemonPaired && userId
        ? await getDaemonDeviceMeta(userId, androidActive ? "android" : "desktop")
        : { hostname: null, platform: null };

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
      const selfImprovementSection = `## Self-Improvement: Building New Jarvis Tools
You can extend yourself by building new tools directly. Generate the complete TypeScript code for the tool yourself and call \`build_feature\` to write it to disk, register it in the tool index, and run a smoke test — all in one step.

**When to build a new tool**: The user asks for a new Jarvis capability that doesn't exist yet (e.g. "add a tool to check stock prices", "build a Notion integration").

**How to build**: Think through what the tool needs to do, write the full TypeScript code following the AgentTool pattern, then call \`build_feature\` with feature_name, description, and tool_code (the complete file content). The tool must export a const of type AgentTool.

**After building**: The server restarts automatically so the new tool becomes active. Use \`test_tool\` to manually re-test any built tool. All builds are logged in Settings → Build History.`;

      const systemPrompt = buildCoachSystemPrompt(goals || [], stats || {}, history || [], resolvedCalendarEvents, lifeContext || null, resolvedGmailItems, resolvedGmailConnected, slackMessages || [], slackConnected ?? false, userCommitments, coachingMode, memories, telegramMessages || [], telegramConnected ?? false, morningNoteSummary, documentsContext, crossChannelContext, soulBlock, daemonSection, emotionalStateBlock, selfImprovementSection, websiteContext);

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

      const lastUserOrigText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      const youtubeCtxBlock = lastUserOrigText
        ? await buildYouTubeContextBlock(lastUserOrigText).catch(() => "")
        : "";

      const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: daemonAbsoluteRule + systemPrompt + proactiveQuestionContext + "\n\nYou can take actions on the user's behalf using the available tools. When a user asks you to add a task, log progress, update their context, etc., use the appropriate tool. Respond naturally — do not mention 'tool calls' or 'functions' to the user. Just confirm what you did conversationally." + (process.env.TAVILY_API_KEY ? "\n\nYou also have a web_search tool. Use it whenever the user asks about current events, live data (weather, stock prices, sports scores, news), or anything requiring real-time information you wouldn't know. Cite your sources naturally in your response." : "") + "\n\nYou have a jarvis_self_diagnose tool. Call it whenever: (a) the user asks about your health, why something isn't working, 'are you OK?', 'what's wrong?', 'why did that fail?', or any question about system reliability; OR (b) you notice a pattern of repeated tool failures in this conversation (2+ different tools returning errors in the same session — call this proactively before the user notices to surface the root cause). It runs a full subsystem check and returns a plain-English diagnosis. When you proactively diagnose yourself, briefly tell the user you noticed something was off and present the diagnosis without being asked." + "\n\nSELF-INSPECTION & CODE PROPOSALS: You have three self-edit tools — list_source_files, read_source_file, and propose_code_change. Use them when: (a) the user asks you to 'look at your own code', 'inspect yourself', 'improve your tools', or 'fix a bug you noticed'; OR (b) you encounter a repeated failure and believe you can fix it with a targeted code change. Workflow: (1) call list_source_files to find the relevant file, (2) call read_source_file to read it fully, (3) call propose_code_change with the complete improved file content and a plain-English reason. The proposal is saved for user review — you NEVER write files directly. Keep proposals minimal and targeted: fix one specific issue per proposal. Never propose changes to the approval gate itself (codeProposalsRoutes.ts). After proposing, tell the user a suggestion is waiting in the Code Proposals screen for their review." },
        ...messages.map((m: { role: string; content: string }, idx: number) => {
          const isLast = idx === messages.length - 1;
          const content = (isLast && m.role === 'user' && youtubeCtxBlock)
            ? m.content + youtubeCtxBlock
            : m.content;
          return { role: m.role as 'user' | 'assistant', content };
        }),
      ];

      const actionResults: { tool: string; result: 'success' | 'error'; label: string; url?: string; buttonLabel?: string; code?: string; channel?: string; screenshotUrl?: string; imageUrl?: string; imageCaption?: string; videoUrl?: string; videoCaption?: string; mcpServerName?: string }[] = [];
      // Accumulates MCP rich attachments across all tool calls in this request.
      // Emitted alongside executedActions in the type:'actions' SSE event to
      // mirror the CoachReplyResult { executedActions, attachments } contract.
      type McpAttachmentSse = { kind: 'image'|'markdown'|'file'|'document'; filename?: string; caption?: string; mimeType?: string; data?: string; text?: string; size?: number; mcpServerName?: string };
      const allMcpAttachments: McpAttachmentSse[] = [];
      let toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      // Track whether the client disconnected mid-stream (e.g. switched to camera app).
      // If so, the full streamed response is saved to DB so it survives the disconnect.
      // Per-run abort support: register an AbortController so the client can stop mid-stream
      const runId = `coach_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
      const abortController = new AbortController();
      const { signal } = abortController;
      activeCoachRuns.set(runId, { controller: abortController, userId: userId ?? '' });
      cleanupRun = () => {
        abortController.abort();
        activeCoachRuns.delete(runId);
      };
      req.on('close', cleanupRun);

      // Expose runId to client via response header (set before first flushHeaders call)
      res.setHeader('X-Run-Id', runId);
      res.setHeader('Access-Control-Expose-Headers', 'X-Run-Id');

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
      stopKeepalive = () => {
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

        // Build per-request tool list including MCP tools for this user
        let requestTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [...coachTools];
        const mcpAgentToolsMap = new Map<string, import("./agent/types").AgentTool>();
        try {
          const { mcpServerRegistry } = await import("./agent/mcp/mcpServerRegistry");
          const mcpAgentTools = mcpServerRegistry.getToolsForUser(userId);
          for (const agentTool of mcpAgentTools) {
            mcpAgentToolsMap.set(agentTool.name, agentTool);
            requestTools.push({
              type: "function",
              function: {
                name: agentTool.name,
                description: agentTool.description,
                parameters: agentTool.parameters as Record<string, unknown>,
              },
            });
          }
        } catch (err) {
          console.warn("[Coach/MCP] failed to load MCP tools:", (err as Error).message);
        }

        // Shared MCP tool context (pendingAttachments accumulate across turns)
        const mcpToolCtx: import("./agent/types").ToolContext = {
          userId,
          channel: originChannel,
          signal,
          state: {
            pendingAttachments: [],
            onProgress: (msg: string) => {
              if (!res.headersSent) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.flushHeaders();
              }
              try { res.write(`data: ${JSON.stringify({ type: 'mcp_progress', message: msg })}\n\n`); } catch {}
            },
          },
        };

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          if (signal.aborted) break;
          const currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            ...chatMessages,
            ...toolMessages,
          ];
          const phase1 = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: currentMessages,
            tools: requestTools,
            // Force a tool call on turn 0 for device-control requests.
            // Subsequent turns use "auto" so the model can stop and respond.
            tool_choice: (turn === 0 && isDeviceControlRequest) ? "required" : "auto",
            max_completion_tokens: 2048,
          }, { signal });

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
                cleanupRun();
                return;
              }
              // Normal conversational response with no tools needed — stream it directly
              res.setHeader('Content-Type', 'text/event-stream');
              res.setHeader('Cache-Control', 'no-cache, no-transform');
              res.setHeader('X-Accel-Buffering', 'no');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.flushHeaders();
              res.write(`data: ${JSON.stringify({ content: responseText })}\n\n`);
              const lastUserMsg0 = [...messages].reverse().find((m: any) => m.role === 'user');
              // Session management — save/extend session and emit sdkSessionId.
              if (userId) {
                try {
                  const { initSession, appendToSession } = await import("./agent/providers/claude");
                  const COACH_APP_AGENT_ID = "coach_app";
                  let appSessionId: string | undefined;
                  if (incomingAppSessionId) {
                    const exchangeMsgs = [
                      { role: "user" as const, content: typeof lastUserMsg0?.content === "string" ? lastUserMsg0.content : "" },
                      { role: "assistant" as const, content: responseText },
                    ];
                    await appendToSession(incomingAppSessionId, COACH_APP_AGENT_ID, userId, exchangeMsgs).catch(() => {});
                    appSessionId = incomingAppSessionId;
                  } else {
                    appSessionId = await initSession(COACH_APP_AGENT_ID, userId, [...chatMessages, { role: "assistant" as const, content: responseText }]);
                    // Seed the prompt cache so subsequent turns skip DB/API lookups.
                    if (appSessionId && !cachedPromptData) {
                      setPromptData(userId, appSessionId, {
                        resolvedGmailConnected, resolvedGmailItems, calendarEvents: resolvedCalendarEvents,
                        userCommitments, memories, morningNoteSummary, documentsContext,
                        proactiveQuestionContext, crossChannelContext,
                        soulBlock, emotionalStateBlock, websiteContext,
                      });
                    }
                  }
                  if (appSessionId) {
                    res.write(`data: ${JSON.stringify({ type: "session_init", sdkSessionId: appSessionId })}\n\n`);
                  }
                } catch { /* non-blocking — never break the response */ }
              }
              res.write('data: [DONE]\n\n');
              res.end();
              extractProfileInBackground(userId, messages);
              detectAndRecordBehaviorSignals(userId, messages);
              markProactiveQuestionsAnswered(userId, messages).catch(() => {});
              if (lastUserMsg0?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsg0.content === 'string' ? lastUserMsg0.content : JSON.stringify(lastUserMsg0.content)).catch(() => {});
              logInteraction(userId, "app_chat", "outbound", responseText).catch(() => {});
              cleanupRun();
              return;
            }
            // turn > 0: model has finished tool calls and returned its final text.
            // Capture it so we can stream it without calling the model again.
            if (choice.message.content) loopFinalText = choice.message.content;
            break;
          }

          // Model returned tool calls — execute them all, then loop for next turn
          toolMessages.push(choice.message);

          const hasWebSearch = choice.message.tool_calls.some(tc => tc.type === 'function' && tc.function.name === 'web_search');
          if (hasWebSearch && !res.headersSent) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.flushHeaders();
            res.write(`data: ${JSON.stringify({ type: 'searching' })}\n\n`);
          }

          for (const tc of choice.message.tool_calls) {
            if (tc.type !== 'function') continue;
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

            // MCP tools are executed via the agent tool registry (not executeCoachTool)
            let execResult: { result: 'success' | 'error'; label: string; detail: string };
            let plainMcpServerName: string | undefined;
            if (tc.function.name.startsWith('mcp__') && mcpAgentToolsMap.has(tc.function.name)) {
              const mcpAgentTool = mcpAgentToolsMap.get(tc.function.name)!;
              // Clear pending attachments from previous turns on this context
              mcpToolCtx.state.pendingAttachments = [];
              if (!res.headersSent) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache, no-transform');
                res.setHeader('X-Accel-Buffering', 'no');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.flushHeaders();
              }
              // Emit a "working" indicator for MCP tools
              const mcpServerDisplayName = (() => {
                const parts = tc.function.name.split('__');
                return parts.length >= 2 ? parts[1].replace(/_/g, ' ') : 'MCP';
              })();
              plainMcpServerName = mcpServerDisplayName;
              res.write(`data: ${JSON.stringify({ type: 'working', message: `Calling ${mcpServerDisplayName}...` })}\n\n`);
              try {
                const toolResult = await mcpAgentTool.execute(args, mcpToolCtx);
                execResult = {
                  result: toolResult.ok ? 'success' : 'error',
                  label: toolResult.ok
                    ? (toolResult.label ?? `Done via ${mcpServerDisplayName}`)
                    : (toolResult.label ?? 'MCP tool error'),
                  detail: toolResult.content ?? toolResult.detail ?? '',
                };
                // Map pendingAttachments to ChannelAttachment-compatible JSON shape.
                // McpAttachmentSse (declared above) mirrors lib/storage.ts McpAttachment.
                const sseAttachments: McpAttachmentSse[] = mcpToolCtx.state.pendingAttachments.map(att => {
                  const serverName = att.mcpServerName ?? mcpServerDisplayName;
                  const approxSize = (data: string | undefined, text: string | undefined): number | undefined => {
                    if (data) return Math.round(data.length * 0.75);
                    if (text) return Buffer.byteLength(text, 'utf8');
                    return undefined;
                  };
                  if (att.kind === 'image') {
                    return { kind: 'image' as const, data: att.data, mimeType: att.mimeType ?? 'image/png', caption: att.caption, size: approxSize(att.data, undefined), mcpServerName: serverName };
                  } else if (att.kind === 'markdown') {
                    return { kind: 'markdown' as const, text: att.text, size: approxSize(undefined, att.text), mcpServerName: serverName };
                  } else {
                    const textContent = typeof att.content === 'string' ? att.content : undefined;
                    return {
                      kind: (att.kind === 'document' ? 'document' : 'file') as 'document' | 'file',
                      filename: att.filename,
                      text: textContent,
                      data: att.data,
                      mimeType: att.mimeType,
                      size: approxSize(att.data, textContent),
                      mcpServerName: serverName,
                    };
                  }
                });
                if (sseAttachments.length > 0) {
                  // Accumulate into allMcpAttachments — emitted with type:'actions' at the end
                  // to mirror CoachReplyResult { executedActions, attachments } in one event.
                  allMcpAttachments.push(...sseAttachments);
                  // Clear plainMcpServerName so we don't also emit a plain attribution action.
                  plainMcpServerName = undefined;
                }
              } catch (err) {
                execResult = {
                  result: 'error',
                  label: 'MCP tool error',
                  detail: err instanceof Error ? err.message : String(err),
                };
              }
            } else {
              execResult = await executeCoachTool(tc.function.name, args, userId, signal);
            }

            // Detect integration connectivity errors in the primary chat and emit
            // a structured integration_error SSE event so the UI can show an
            // actionable "Reconnect <integration>" prompt inline.
            // Uses the capability registry to determine which integrations a
            // failed tool depends on, then validates against the live integration
            // status — works for any integration without brittle label matching.
            if (execResult.result === 'error' && userId) {
              try {
                const { capabilityRegistry } = await import('./capabilities/index');
                const integrationDeps = capabilityRegistry.getIntegrationDeps();
                // Build reverse map: toolName → integration IDs that require it
                const toolToIntegrations = new Map<string, string[]>();
                for (const [integId, { toolNames }] of Object.entries(integrationDeps)) {
                  for (const toolName of toolNames) {
                    const existing = toolToIntegrations.get(toolName) ?? [];
                    if (!existing.includes(integId)) existing.push(integId);
                    toolToIntegrations.set(toolName, existing);
                  }
                }
                const candidateIntegrations = toolToIntegrations.get(tc.function.name) ?? [];
                if (candidateIntegrations.length > 0) {
                  const { getUserIntegrationStatuses } = await import('./intelligence/integrationValidator');
                  const liveStatuses = await getUserIntegrationStatuses(userId);
                  // Auth signals used to gate expiring_soon (still functional) cases —
                  // avoids misclassifying generic tool failures as reconnect events.
                  const detail = (execResult.detail ?? '').toLowerCase();
                  const authSignals = ['401', '403', 'unauthorized', 'forbidden', 'expired',
                    'invalid_grant', 'revoked', 'token', 'authentication', 'oauth',
                    'permission denied', 'scope', 'credentials', 'unauthenticated', 'access denied'];
                  const hasAuthSignal = authSignals.some((s) => detail.includes(s));
                  // For multi-provider tools that fail with auth signals but no provider
                  // is definitively broken (stale validator), attempt to disambiguate
                  // by provider hint in the error text to avoid misattribution.
                  const providerHint = /microsoft|outlook|office365/i.test(detail)
                    ? 'outlook'
                    : /google|gmail/i.test(detail)
                      ? 'google'
                      : null;
                  const isMultiProvider = candidateIntegrations.length > 1;
                  for (const integKey of candidateIntegrations) {
                    const integStatus = liveStatuses[integKey as keyof typeof liveStatuses];
                    // Primary: emit when validator confirms broken (authoritative, no ambiguity).
                    // Fallback: hasAuthSignal covers mid-run expiry with stale cached status.
                    //   For multi-provider tools, only fall back if provider hint matches
                    //   this integKey — otherwise suppress to avoid wrong reconnect flow.
                    const canFallback = !isMultiProvider || (providerHint === integKey);
                    const shouldEmit = integStatus === 'broken' || (hasAuthSignal && canFallback);
                    if (shouldEmit) {
                      if (!res.headersSent) {
                        res.setHeader('Content-Type', 'text/event-stream');
                        res.setHeader('Cache-Control', 'no-cache, no-transform');
                        res.setHeader('X-Accel-Buffering', 'no');
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.flushHeaders();
                      }
                      const coachIntegrationLabels: Record<string, string> = {
                        google: 'Google', outlook: 'Outlook', slack: 'Slack',
                        telegram: 'Telegram', discord: 'Discord', whatsapp: 'WhatsApp',
                      };
                      const coachLabel = coachIntegrationLabels[integKey] ?? integKey;
                      const safeMsg = `Your ${coachLabel} connection has expired and needs to be reconnected.`;
                      console.debug(`[Coach/SSE] integration_error detail: ${(execResult.detail ?? '').slice(0, 300)}`);
                      res.write(`data: ${JSON.stringify({ type: 'integration_error', integration: integKey, message: safeMsg })}\n\n`);
                      break; // emit for the first broken integration found
                    }
                  }
                }
              } catch { /* best-effort — never block the chat loop */ }
            }

            let linkData: { url?: string; buttonLabel?: string; code?: string; channel?: string; screenshotUrl?: string; imageUrl?: string; imageCaption?: string; videoUrl?: string; videoCaption?: string } = {};
            if ((tc.function.name === 'generate_reconnect_link' || tc.function.name === 'connect_channel') && execResult.result === 'success') {
              try { linkData = JSON.parse(execResult.detail); } catch {}
            }
            if (tc.function.name === 'daemon_action' && String(args.action) === 'android_screenshot' && execResult.result === 'success') {
              try { const parsed = JSON.parse(execResult.detail); if (parsed.screenshotUrl) linkData.screenshotUrl = parsed.screenshotUrl; } catch {}
            }
            if (tc.function.name === 'image_generate' && execResult.result === 'success') {
              try {
                const parsed = JSON.parse(execResult.detail);
                if (parsed.imageUrl) linkData.imageUrl = parsed.imageUrl;
                if (parsed.caption) linkData.imageCaption = parsed.caption;
              } catch {}
            }
            if (tc.function.name === 'generate_video' && execResult.result === 'success') {
              try {
                const parsed = JSON.parse(execResult.detail);
                if (parsed.videoUrl) linkData.videoUrl = parsed.videoUrl;
                if (parsed.caption) linkData.videoCaption = parsed.caption;
              } catch {}
            }
            actionResults.push({ tool: tc.function.name, result: execResult.result, label: execResult.label, ...linkData, ...(plainMcpServerName ? { mcpServerName: plainMcpServerName } : {}) });
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
          if (actionResults.length > 0 || allMcpAttachments.length > 0) {
            const nonSearchActions = actionResults.filter(a => a.tool !== 'web_search');
            if (nonSearchActions.length > 0 || allMcpAttachments.length > 0) {
              const actionsPayload: Record<string, unknown> = { type: 'actions', actions: nonSearchActions };
              if (allMcpAttachments.length > 0) actionsPayload.attachments = allMcpAttachments;
              res.write(`data: ${JSON.stringify(actionsPayload)}\n\n`);
            }
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
          detectAndRecordBehaviorSignals(userId, messages);
          markProactiveQuestionsAnswered(userId, messages).catch(() => {});
          const lastUserMsgLoop = [...messages].reverse().find((m: any) => m.role === 'user');
          if (lastUserMsgLoop?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsgLoop.content === 'string' ? lastUserMsgLoop.content : JSON.stringify(lastUserMsgLoop.content)).catch(() => {});
          logInteraction(userId, "app_chat", "outbound", loopFinalText).catch(() => {});
          cleanupRun();
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

      if (actionResults.length > 0 || allMcpAttachments.length > 0) {
        const nonSearchActions = actionResults.filter(a => a.tool !== 'web_search');
        if (nonSearchActions.length > 0 || allMcpAttachments.length > 0) {
          const actionsPayload: Record<string, unknown> = { type: 'actions', actions: nonSearchActions };
          if (allMcpAttachments.length > 0) actionsPayload.attachments = allMcpAttachments;
          res.write(`data: ${JSON.stringify(actionsPayload)}\n\n`);
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
        model: "gpt-4o-mini",
        messages: streamMessages,
        stream: true,
        max_completion_tokens: 8192,
      }, { signal });

      stopKeepalive();
      let fullStreamedReply = '';
      for await (const chunk of stream) {
        if (signal.aborted) break;
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

      // Session management — save/extend session and emit sdkSessionId.
      if (userId && fullStreamedReply && !clientDisconnected) {
        try {
          const { initSession, appendToSession } = await import("./agent/providers/claude");
          const COACH_APP_AGENT_ID = "coach_app";
          const lastUserMsgForSession = [...messages].reverse().find((m: any) => m.role === 'user');
          let appSessionId: string | undefined;
          if (incomingAppSessionId) {
            const exchangeMsgs = [
              { role: "user" as const, content: typeof lastUserMsgForSession?.content === "string" ? lastUserMsgForSession.content : "" },
              { role: "assistant" as const, content: fullStreamedReply },
            ];
            await appendToSession(incomingAppSessionId, COACH_APP_AGENT_ID, userId, exchangeMsgs).catch(() => {});
            appSessionId = incomingAppSessionId;
          } else {
            appSessionId = await initSession(COACH_APP_AGENT_ID, userId, [...chatMessages, { role: "assistant" as const, content: fullStreamedReply }]);
            // Seed the prompt cache so subsequent turns skip DB/API lookups.
            if (appSessionId && !cachedPromptData) {
              setPromptData(userId, appSessionId, {
                resolvedGmailConnected, resolvedGmailItems, calendarEvents: resolvedCalendarEvents,
                userCommitments, memories, morningNoteSummary, documentsContext,
                proactiveQuestionContext, crossChannelContext,
                soulBlock, emotionalStateBlock, websiteContext,
              });
            }
          }
          if (appSessionId) {
            try { res.write(`data: ${JSON.stringify({ type: "session_init", sdkSessionId: appSessionId })}\n\n`); } catch {}
          }
        } catch { /* non-blocking — never break the response */ }
      }
      cleanupRun();
      if (!clientDisconnected) {
        if (signal.aborted) {
          res.write(`data: ${JSON.stringify({ type: 'aborted' })}\n\n`);
        } else {
          res.write('data: [DONE]\n\n');
        }
        res.end();
      }
      if (userId) {
        extractProfileInBackground(userId, messages);
        detectAndRecordBehaviorSignals(userId, messages);
        markProactiveQuestionsAnswered(userId, messages).catch(() => {});
        const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
        if (lastUserMsg?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)).catch(() => {});
        if (fullStreamedReply) logInteraction(userId, "app_chat", "outbound", fullStreamedReply).catch(() => {});
      }
    } catch (error) {
      stopKeepalive();
      cleanupRun();
      // Graceful abort — user pressed Stop
      if (error instanceof Error && (error.name === 'AbortError' || error.message?.includes('aborted'))) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('X-Accel-Buffering', 'no');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.flushHeaders();
        }
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'aborted' })}\n\n`);
          res.end();
        }
        return;
      }
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

  app.post("/api/chat/abort", async (req: Request, res: Response) => {
    const callerId = req.userId;
    if (!callerId) return res.status(401).json({ error: "Unauthorized" });
    const { runId } = req.body;
    if (!runId) return res.status(400).json({ error: "runId required" });
    const run = activeCoachRuns.get(runId);
    if (!run) return res.json({ ok: true });
    if (run.userId !== callerId) return res.status(403).json({ error: "Forbidden" });
    run.controller.abort();
    activeCoachRuns.delete(runId);

    // Cancel any pending transcript jobs for this user so the background
    // poller does not complete and notify them after they pressed Stop.
    try {
      const { cancelUserTranscriptJobs } = await import('./lib/transcriptJobTracker');
      const cancelled = await cancelUserTranscriptJobs(run.userId);
      if (cancelled > 0) {
        console.log(`[abort] Cancelled ${cancelled} pending transcript job(s) for user ${run.userId}`);
      }
    } catch (err) {
      console.warn(`[abort] Failed to cancel transcript jobs: ${err instanceof Error ? err.message : String(err)}`);
    }

    return res.json({ ok: true });
  });

  // ── Web-chat invite tokens ────────────────────────────────────────────────
  // GET /api/webchat/invite/active — returns the owner's current unexpired token (if any)
  app.get("/api/webchat/invite/active", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const [row] = await db
        .select()
        .from(webchatInviteTokens)
        .where(and(eq(webchatInviteTokens.userId, userId), gte(webchatInviteTokens.expiresAt, new Date())))
        .limit(1);

      if (!row) return res.json({ active: false });

      const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
      const protocol = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
      const url = `${protocol}://${host}/chat?invite=${row.token}`;

      return res.json({ active: true, token: row.token, url, expiresAt: row.expiresAt });
    } catch (error) {
      console.error("Error fetching active webchat invite token:", error);
      return res.status(500).json({ error: "Failed to fetch active invite token" });
    }
  });

  // POST /api/webchat/invite — owner generates (or retrieves) a 24-hour shareable link token
  app.post("/api/webchat/invite", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;

      const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
      const protocol = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");

      // Return existing unexpired token if one already exists
      const [existing] = await db
        .select()
        .from(webchatInviteTokens)
        .where(and(eq(webchatInviteTokens.userId, userId), gte(webchatInviteTokens.expiresAt, new Date())))
        .limit(1);

      if (existing) {
        const url = `${protocol}://${host}/chat?invite=${existing.token}`;
        return res.json({ token: existing.token, url, expiresAt: existing.expiresAt });
      }

      const { randomBytes } = await import("crypto");
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 h

      await db.insert(webchatInviteTokens).values({ token, userId, expiresAt });

      const url = `${protocol}://${host}/chat?invite=${token}`;
      return res.json({ token, url, expiresAt });
    } catch (error) {
      console.error("Error creating webchat invite token:", error);
      return res.status(500).json({ error: "Failed to create invite token" });
    }
  });

  // DELETE /api/webchat/invite/:token — owner revokes an active invite link
  app.delete("/api/webchat/invite/:token", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const token = _p(req.params.token);

      const [row] = await db
        .select()
        .from(webchatInviteTokens)
        .where(eq(webchatInviteTokens.token, token))
        .limit(1);

      if (!row) return res.status(404).json({ error: "Token not found" });
      if (row.userId !== userId) return res.status(403).json({ error: "Forbidden" });

      await db.delete(webchatInviteTokens).where(eq(webchatInviteTokens.token, token));

      return res.json({ ok: true });
    } catch (error) {
      console.error("Error revoking webchat invite token:", error);
      return res.status(500).json({ error: "Failed to revoke invite token" });
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
        model: 'gpt-4o-mini',
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
        model: "gpt-4o-mini",
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
        model: "gpt-4o-mini",
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
        model: "gpt-4o-mini",
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

      // Size guards: skip silent/empty clips, reject huge files
      if (rawBuffer.length < 1024) {
        return res.json({ text: "" });
      }
      if (rawBuffer.length > 20 * 1024 * 1024) {
        return res.status(400).json({ error: "Audio file is too large (max 20 MB). Please send a shorter recording." });
      }

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

      const { text, voice: voiceParam } = req.body;
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

      // Resolve voice: explicit param → user's saved preference → default 'nova'
      let resolvedVoice = voiceParam && typeof voiceParam === 'string' ? voiceParam : null;
      if (!resolvedVoice) {
        const { getUserTtsPrefs } = await import('./agent/tools/tts');
        const prefs = await getUserTtsPrefs(userId);
        // Fallback only supports OpenAI MP3; map ElevenLabs voices to closest OpenAI voice
        const OPENAI_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);
        resolvedVoice = OPENAI_VOICES.has(prefs.voice) ? prefs.voice : 'nova';
      }

      const { textToSpeech } = await import('./replit_integrations/audio/client');
      const audioBuffer = await textToSpeech(trimmedText, (resolvedVoice ?? "nova") as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer", 'mp3');
      res.json({ audio: audioBuffer.toString('base64') });
    } catch (error) {
      console.error("Error generating speech:", error);
      res.status(500).json({ error: "Failed to generate speech" });
    }
  });

  /**
   * Streaming TTS endpoint — streams PCM16 chunks (24 kHz, mono, 16-bit LE) as
   * newline-delimited JSON so the mobile client can begin playback before the
   * entire audio is generated.
   *
   * Response format (one JSON object per line):
   *   {"type":"chunk","data":"<base64-pcm16>","sampleRate":24000}\n  ← audio chunk
   *   {"type":"done"}\n                                               ← end of stream
   *   {"type":"error","message":"..."}\n                              ← on failure
   *
   * ElevenLabs voices (non-OpenAI IDs) use the ElevenLabs /stream endpoint with
   * optimize_streaming_latency=2 and pcm_24000 output format.
   * OpenAI voices use the gpt-audio streaming path (textToSpeechStream).
   */
  app.post("/api/tts/stream", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const { text, voice: voiceOverride, latencyTier } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: "text is required" });
    }

    let trimmedText = text.slice(0, 4000);
    if (text.length > 4000) {
      const lastSentence = trimmedText.lastIndexOf('.');
      if (lastSentence > 0) trimmedText = trimmedText.slice(0, lastSentence + 1);
    }

    const OPENAI_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);

    // Resolve voice: explicit override → user's saved preference → default "nova"
    const { getUserTtsPrefs } = await import('./agent/tools/tts');
    const prefs = await getUserTtsPrefs(userId);
    const resolvedVoice = (voiceOverride && typeof voiceOverride === "string")
      ? voiceOverride.toLowerCase()
      : (prefs.voice || "nova");

    const isElevenLabs = !OPENAI_VOICES.has(resolvedVoice);

    // ElevenLabs latency tier: 0=best quality, 4=lowest latency; default from user prefs (fallback 2)
    const elLatency = (typeof latencyTier === "number" && latencyTier >= 0 && latencyTier <= 4)
      ? latencyTier : (prefs.latencyTier ?? 2);

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    const writeLine = (obj: object) => {
      if (!res.destroyed) {
        try { res.write(JSON.stringify(obj) + "\n"); } catch { /* connection closed */ }
      }
    };

    // Abort provider stream when client disconnects early
    const streamAbort = new AbortController();
    req.on('close', () => streamAbort.abort());

    try {
      const { textToSpeechStream, elevenlabsTtsStream } = await import('./replit_integrations/audio/client');

      const openaiVoice = OPENAI_VOICES.has(resolvedVoice)
        ? resolvedVoice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer"
        : "nova";

      const stream = isElevenLabs && process.env.ELEVENLABS_API_KEY
        ? await elevenlabsTtsStream(trimmedText, resolvedVoice, "eleven_turbo_v2_5", elLatency as 0 | 1 | 2 | 3 | 4, streamAbort.signal)
        : await textToSpeechStream(trimmedText, openaiVoice, streamAbort.signal);

      for await (const base64Chunk of stream) {
        if (res.destroyed || streamAbort.signal.aborted) break;
        writeLine({ type: "chunk", data: base64Chunk, sampleRate: 24000 });
      }
      if (!streamAbort.signal.aborted) {
        writeLine({ type: "done" });
        res.end();
      }
    } catch (error) {
      console.error("[/api/tts/stream] error:", error);
      writeLine({ type: "error", message: error instanceof Error ? error.message : "TTS stream failed" });
      res.end();
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
      const id = _p(req.params.id);
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
      const id = _p(req.params.id);
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
        model: "gpt-4o-mini",
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

      const soulBlock = await getSoulPromptBlock(userId ?? "");
      const systemPrompt = buildCoachSystemPrompt(goals || [], stats || {}, history || [], [], lifeContext || null, [], false, [], false, userCommitments, undefined, [], [], false, undefined, undefined, undefined, soulBlock);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.flushHeaders();

      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
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
        model: "gpt-4o-mini",
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

  app.get("/api/memory/pending-review", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.execute<{
        id: string; content: string; category: string; memory_type: string;
        tier: string; confidence: number; extracted_at: string;
      }>(sql`
        SELECT id, content, category, memory_type, tier, confidence, extracted_at
        FROM user_memories
        WHERE user_id = ${userId}
          AND pending_review = TRUE
          AND review_status = 'pending'
        ORDER BY extracted_at DESC
        LIMIT 50
      `);
      res.json({ memories: rows.rows ?? [] });
    } catch (error) {
      console.error("Error fetching pending-review memories:", error);
      res.status(500).json({ error: "Failed to fetch pending memories" });
    }
  });

  app.patch("/api/memory/:id/review", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const { action, updatedContent } = req.body as { action: "keep" | "edit" | "discard"; updatedContent?: string };
      if (!["keep", "edit", "discard"].includes(action)) {
        return res.status(400).json({ error: "action must be keep, edit, or discard" });
      }
      if (action === "discard") {
        // Soft-delete: mark as discarded so the audit trail is preserved.
        // pending_review stays TRUE for the discard case to indicate this was reviewed but rejected.
        const result = await db.execute(sql`
          UPDATE user_memories
          SET review_status = 'discarded'
          WHERE id = ${id} AND user_id = ${userId} AND pending_review = TRUE AND review_status = 'pending'
          RETURNING id
        `);
        if ((result.rows ?? []).length === 0) return res.status(404).json({ error: "Memory not found" });
        return res.json({ ok: true });
      }
      if (action === "edit") {
        if (!updatedContent || typeof updatedContent !== "string" || !updatedContent.trim()) {
          return res.status(400).json({ error: "updatedContent is required for edit action" });
        }
        const result = await db.execute(sql`
          UPDATE user_memories
          SET content = ${updatedContent.trim()}, pending_review = FALSE, review_status = 'edited'
          WHERE id = ${id} AND user_id = ${userId} AND pending_review = TRUE
          RETURNING id
        `);
        if ((result.rows ?? []).length === 0) return res.status(404).json({ error: "Memory not found" });
        markSoulStale(userId).catch(() => {});
        return res.json({ ok: true });
      }
      // action === "keep"
      const result = await db.execute(sql`
        UPDATE user_memories
        SET pending_review = FALSE, review_status = 'kept'
        WHERE id = ${id} AND user_id = ${userId} AND pending_review = TRUE
        RETURNING id
      `);
      if ((result.rows ?? []).length === 0) return res.status(404).json({ error: "Memory not found" });
      markSoulStale(userId).catch(() => {});
      return res.json({ ok: true });
    } catch (error) {
      console.error("Error reviewing memory:", error);
      res.status(500).json({ error: "Failed to review memory" });
    }
  });

  app.patch("/api/memories/pending/approve-all", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const result = await db.execute(sql`
        UPDATE user_memories
        SET pending_review = FALSE, review_status = 'kept'
        WHERE user_id = ${userId}
          AND pending_review = TRUE
          AND review_status = 'pending'
        RETURNING id
      `);
      const count = (result.rows ?? []).length;
      if (count > 0) {
        markSoulStale(userId).catch(() => {});
      }
      res.json({ ok: true, approved: count });
    } catch (error) {
      console.error("Error bulk-approving pending memories:", error);
      res.status(500).json({ error: "Failed to approve pending memories" });
    }
  });

  app.get("/api/memories/fading", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const rows = await db.select()
        .from(userMemories)
        .where(
          sql`${userMemories.userId} = ${userId}
            AND ${userMemories.tier} = 'long_term'
            AND ${userMemories.relevanceScore} <= 30
            AND COALESCE(${userMemories.lastReferencedAt}, ${userMemories.extractedAt}) < ${thirtyDaysAgo}`
        )
        .orderBy(userMemories.relevanceScore);
      res.json({ memories: rows });
    } catch (error) {
      console.error("Error fetching fading memories:", error);
      res.status(500).json({ error: "Failed to fetch fading memories" });
    }
  });

  app.post("/api/memories/:id/keep", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const result = await db.execute(sql`
        UPDATE user_memories
        SET relevance_score = 50,
            last_referenced_at = NOW()
        WHERE id = ${id}
          AND user_id = ${userId}
        RETURNING id
      `);
      if ((result.rows ?? []).length === 0) {
        return res.status(404).json({ error: "Memory not found" });
      }
      res.json({ ok: true });
    } catch (error) {
      console.error("Error keeping memory:", error);
      res.status(500).json({ error: "Failed to keep memory" });
    }
  });

  app.delete("/api/memories/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
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

  // ── Workspace file API ────────────────────────────────────────────────────
  // GET  /api/workspace/:file   — read a workspace file (owner only)
  // POST /api/workspace/:file   — write a workspace file (owner only)
  //
  // IMPORTANT: specific literal routes (e.g. /synthesise) MUST be registered
  // BEFORE the /:file wildcard so Express resolves them correctly.

  const WORKSPACE_VALID_KEYS = ["soul", "agents", "memory", "errors", "corrections", "feature_requests"] as const;
  type WFKey = typeof WORKSPACE_VALID_KEYS[number];
  function isWFKey(k: string): k is WFKey {
    return (WORKSPACE_VALID_KEYS as readonly string[]).includes(k);
  }

  // ── Workspace synthesis endpoint — registered BEFORE /:file wildcard ──────
  // POST /api/workspace/synthesise — owner-only, triggers LLM learning review
  app.post("/api/workspace/synthesise", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { isIntegrationOwner } = await import("./integrationOwner");
      if (!await isIntegrationOwner(userId)) {
        return res.status(403).json({ error: "Owner access required" });
      }

      const body = req.body as { dryRun?: boolean; archiveAfter?: boolean };
      const applyToMemory = body.dryRun !== true;
      const archiveAfter = applyToMemory && body.archiveAfter === true;

      const { synthesiseLearnings } = await import("./intelligence/learningSynthesiser");
      const result = await synthesiseLearnings(applyToMemory, archiveAfter);

      // Structured audit entry — written to the server's persistent audit trail.
      console.log(
        `[Audit] workspace_synthesise user=${userId} triggered=manual bullets=${result.bullets.length} ` +
        `skipped=${result.skipped} applied=${result.appendedToMemory} archived=${result.archived} ` +
        `correctionLines=${result.correctionLines} errorLines=${result.errorLines}`,
      );

      res.json({ ok: true, ...result });
    } catch (error) {
      console.error("[Workspace] synthesise error:", error);
      res.status(500).json({ error: "Failed to synthesise learnings" });
    }
  });

  // GET /api/workspace/synthesise-history — last 5 synthesis runs (owner only)
  app.get("/api/workspace/synthesise-history", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { isIntegrationOwner } = await import("./integrationOwner");
      if (!await isIntegrationOwner(userId)) {
        return res.status(403).json({ error: "Owner access required" });
      }

      const rows = await db
        .select()
        .from(schema.learningSynthesisLog)
        .orderBy(desc(schema.learningSynthesisLog.createdAt))
        .limit(5);

      res.json({ runs: rows });
    } catch (error) {
      console.error("[Workspace] synthesise-history error:", error);
      res.status(500).json({ error: "Failed to fetch synthesis history" });
    }
  });

  app.get("/api/workspace/:file", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { isIntegrationOwner } = await import("./integrationOwner");
      if (!await isIntegrationOwner(userId)) {
        return res.status(403).json({ error: "Owner access required" });
      }

      const fileParam = _p(req.params.file);
      if (!isWFKey(fileParam)) {
        return res.status(400).json({ error: `Invalid file key: ${fileParam}` });
      }

      const { readWorkspaceFile } = await import("./workspace/loader");
      const content = await readWorkspaceFile(fileParam);
      res.json({ file: fileParam, content });
    } catch (error) {
      console.error("[Workspace] GET error:", error);
      res.status(500).json({ error: "Failed to read workspace file" });
    }
  });

  app.post("/api/workspace/:file", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { isIntegrationOwner } = await import("./integrationOwner");
      if (!await isIntegrationOwner(userId)) {
        return res.status(403).json({ error: "Owner access required" });
      }

      const fileParam = _p(req.params.file);
      if (!isWFKey(fileParam)) {
        return res.status(400).json({ error: `Invalid file key: ${fileParam}` });
      }

      const body = req.body as { content?: unknown; mode?: unknown };
      const content = typeof body.content === "string" ? body.content : "";
      const mode = body.mode === "append" ? "append" : "overwrite";

      const { writeWorkspaceFile } = await import("./workspace/loader");
      await writeWorkspaceFile(fileParam, content, mode);

      res.json({ ok: true, file: fileParam, mode });
    } catch (error) {
      console.error("[Workspace] POST error:", error);
      res.status(500).json({ error: "Failed to write workspace file" });
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
      await deletePerson(userId, _p(req.params.id));
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

  // Dream Cycle — return history of all dream insights for the user,
  // newest first. Grouped by dream_date for display in the app.
  app.get("/api/dream-insights", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db
        .select()
        .from(schema.dreamInsights)
        .where(eq(schema.dreamInsights.userId, userId))
        .orderBy(desc(schema.dreamInsights.createdAt))
        .limit(50);
      return res.json({ insights: rows });
    } catch (error) {
      console.error("Error getting dream insights:", error);
      return res.status(500).json({ error: "Failed to get dream insights" });
    }
  });

  // Trigger a manual dream cycle run for the current user (useful for testing).
  // Only runs if the user has at least 2 weeks of memory data.
  app.post("/api/dream-insights/run", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const dreamDate = new Date().toISOString().slice(0, 10);
      const manualKey = `dream_manual:${dreamDate}`;
      const existing = await db
        .select({ id: schema.proactiveScheduleLog.id })
        .from(schema.proactiveScheduleLog)
        .where(
          and(
            eq(schema.proactiveScheduleLog.userId, userId),
            eq(schema.proactiveScheduleLog.messageType, manualKey),
            eq(schema.proactiveScheduleLog.sentDate, dreamDate),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        return res.status(429).json({ error: "Dream cycle already run today. Try again tomorrow." });
      }
      const { runDreamForUser } = await import("./memory/dream");
      const dreamResult = await runDreamForUser(userId, dreamDate);
      await db.insert(schema.proactiveScheduleLog).values({
        userId, messageType: manualKey, sentDate: dreamDate,
      }).catch(() => {});
      return res.json({
        count: dreamResult.insightsStored,
        dreamDate,
        consolidation: dreamResult.consolidation,
        semanticExtraction: dreamResult.semanticExtraction,
        decay: dreamResult.decay,
        reinforcement: dreamResult.reinforcement,
      });
    } catch (error) {
      console.error("Error running dream cycle:", error);
      return res.status(500).json({ error: "Failed to run dream cycle" });
    }
  });

  // Fetch the actual memory records that contributed to a dream insight's synthesis.
  // Returns up to 10 representative memories from sourceMemoryIds.
  app.get("/api/dream-insights/:insightId/memories", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const insightId = _p(req.params.insightId);
      const insightRows = await db
        .select({ sourceMemoryIds: schema.dreamInsights.sourceMemoryIds })
        .from(schema.dreamInsights)
        .where(
          and(
            eq(schema.dreamInsights.id, insightId),
            eq(schema.dreamInsights.userId, userId),
          ),
        )
        .limit(1);
      if (insightRows.length === 0) return res.status(404).json({ error: "Not found" });
      const ids = (insightRows[0].sourceMemoryIds as string[] | null) || [];
      if (ids.length === 0) return res.json({ memories: [] });
      const { inArray } = await import("drizzle-orm");
      const memories = await db
        .select({
          id: schema.userMemories.id,
          content: schema.userMemories.content,
          category: schema.userMemories.category,
          confidence: schema.userMemories.confidence,
          extractedAt: schema.userMemories.extractedAt,
        })
        .from(schema.userMemories)
        .where(
          and(
            eq(schema.userMemories.userId, userId),
            inArray(schema.userMemories.id, ids.slice(0, 50)),
          ),
        )
        .limit(10);
      return res.json({ memories });
    } catch (error) {
      console.error("Error getting dream source memories:", error);
      return res.status(500).json({ error: "Failed to get source memories" });
    }
  });

  // ── Prediction Engine ─────────────────────────────────────────────────────

  app.get("/api/predictions", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const { getTodayPredictions } = await import("./intelligence/predictor");
      const predictions = await getTodayPredictions(userId, date, 0);
      return res.json({ predictions });
    } catch (error) {
      console.error("Error getting predictions:", error);
      return res.status(500).json({ error: "Failed to get predictions" });
    }
  });

  app.get("/api/predictions/week", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const startDate = (req.query.startDate as string) || new Date().toISOString().slice(0, 10);
      const { getWeekPredictions } = await import("./intelligence/predictor");
      const predictions = await getWeekPredictions(userId, startDate, 0);
      return res.json({ predictions });
    } catch (error) {
      console.error("Error getting week predictions:", error);
      return res.status(500).json({ error: "Failed to get week predictions" });
    }
  });

  app.get("/api/predictions/accuracy", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { getPredictionAccuracy } = await import("./intelligence/predictor");
      const accuracy = await getPredictionAccuracy(userId);
      return res.json(accuracy);
    } catch (error) {
      console.error("Error getting prediction accuracy:", error);
      return res.status(500).json({ error: "Failed to get accuracy" });
    }
  });

  const _predRunLastAt = new Map<string, number>();
  const PRED_RUN_COOLDOWN_MS = 30 * 60 * 1000;

  app.post("/api/predictions/run", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const lastRun = _predRunLastAt.get(userId) ?? 0;
      const msSinceLast = Date.now() - lastRun;
      if (msSinceLast < PRED_RUN_COOLDOWN_MS) {
        const retryAfterSec = Math.ceil((PRED_RUN_COOLDOWN_MS - msSinceLast) / 1000);
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({ error: "Rate limit — predictions were just generated", retryAfterSec });
      }
      _predRunLastAt.set(userId, Date.now());

      const targetDate = (req.body?.date as string) || new Date().toISOString().slice(0, 10);
      const { analysePatterns } = await import("./intelligence/pattern-analyser");
      const { generateAndStorePredictions } = await import("./intelligence/predictor");
      const analysis = await analysePatterns(userId, 60);
      const count = await generateAndStorePredictions(userId, targetDate, analysis);
      return res.json({ generated: count, date: targetDate });
    } catch (error) {
      console.error("Error running prediction engine:", error);
      return res.status(500).json({ error: "Failed to run predictions" });
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

  app.patch("/api/life-context", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const updates = req.body;
      const existing = await db
        .select({ data: schema.lifeContext.data })
        .from(schema.lifeContext)
        .where(eq(schema.lifeContext.userId, userId))
        .limit(1);
      const current = (existing[0]?.data as any) || {};
      const merged = { ...current, ...updates };
      await db.insert(schema.lifeContext)
        .values({ userId, data: merged, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.lifeContext.userId],
          set: { data: merged, updatedAt: new Date() },
        });
      return res.json(merged);
    } catch (error) {
      console.error("Error patching life-context:", error);
      return res.status(500).json({ error: "Failed to update life context" });
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
      model: "gpt-4o-mini",
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
      const statusFilter = typeof req.query.status === "string" ? req.query.status : "pending";
      // When fetching dismissed items, only return triage-auto-dismissed ones
      // (jarvisReason IS NOT NULL) to avoid surfacing user-manually-dismissed items
      // in the "Auto-handled" section.
      const whereClause = statusFilter === "dismissed"
        ? and(
            eq(schema.inboxItems.userId, userId),
            eq(schema.inboxItems.status, statusFilter),
            sql`${schema.inboxItems.jarvisReason} IS NOT NULL`
          )
        : and(eq(schema.inboxItems.userId, userId), eq(schema.inboxItems.status, statusFilter));
      const items = await db
        .select()
        .from(schema.inboxItems)
        .where(whereClause)
        .orderBy(desc(schema.inboxItems.surfacedAt))
        .limit(50);
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
      const id = _p(req.params.id);

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
      const id = _p(req.params.id);
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

  app.patch("/api/jarvis/scheduled-tasks/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const updates: Record<string, unknown> = {};
      if (typeof req.body.active === "boolean") updates.active = req.body.active;
      if (req.body.title) updates.title = req.body.title;
      if (req.body.description !== undefined) updates.description = req.body.description || null;
      if (req.body.scheduledAt) updates.scheduledAt = new Date(req.body.scheduledAt);
      if (req.body.recurrence !== undefined) updates.recurrence = req.body.recurrence || null;
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updatable fields provided" });
      const [task] = await db
        .update(schema.jarvisScheduledTasks)
        .set(updates)
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)))
        .returning();
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (err) {
      console.error("Error updating jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  app.delete("/api/jarvis/scheduled-tasks/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      await db
        .delete(schema.jarvisScheduledTasks)
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("Error deleting jarvis scheduled task:", err);
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  app.post("/api/jarvis/scheduled-tasks/:id/run", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);

      const [task] = await db
        .select()
        .from(schema.jarvisScheduledTasks)
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)))
        .limit(1);

      if (!task) return res.status(404).json({ error: "Task not found" });
      if (!task.shellCommand) return res.status(400).json({ error: "Task has no shell command" });

      const { sendDaemonOp, isDesktopDaemonActive, isDaemonActionAllowed } = await import("./daemon/bridge");

      if (!isDesktopDaemonActive(userId)) {
        return res.status(503).json({ error: "Desktop daemon is not connected." });
      }
      const shellAllowed = await isDaemonActionAllowed(userId, "shell");
      if (!shellAllowed) {
        return res.status(403).json({ error: "Shell execution is not permitted on this daemon." });
      }
      const allowOutsideRoot = await isDaemonActionAllowed(userId, "allow_outside_root");
      const timeoutMs = 120_000;
      const startedAt = Date.now();

      let runResult: { ok: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number; error?: string };
      try {
        const daemonResult = await sendDaemonOp(
          userId,
          { type: "shell", cmd: task.shellCommand, timeoutMs, allowOutsideRoot },
          timeoutMs + 5_000,
        );
        const durationMs = Date.now() - startedAt;
        const data = (daemonResult.data || {}) as Record<string, unknown>;
        runResult = {
          ok: daemonResult.ok,
          exitCode: typeof data.code === "number" ? data.code : (daemonResult.ok ? 0 : 1),
          stdout: typeof data.stdout === "string" ? data.stdout : "",
          stderr: typeof data.stderr === "string" ? data.stderr : "",
          durationMs,
        };
      } catch (err) {
        runResult = {
          ok: false,
          exitCode: -1,
          stdout: "",
          stderr: "",
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const ranAt = new Date().toISOString();
      const shellResult = {
        exitCode: runResult.exitCode,
        stdout: runResult.stdout.slice(0, 8000),
        stderr: runResult.stderr.slice(0, 2000),
        durationMs: runResult.durationMs,
        ranAt,
      };

      await db
        .update(schema.jarvisScheduledTasks)
        .set({ lastShellResult: shellResult })
        .where(and(eq(schema.jarvisScheduledTasks.id, id), eq(schema.jarvisScheduledTasks.userId, userId)));

      console.log(`[Routes] Manual run: task id=${id} exit=${runResult.exitCode} dur=${runResult.durationMs}ms`);

      res.json({ ok: true, result: shellResult, error: runResult.error });
    } catch (err) {
      console.error("Error running scheduled task:", err);
      res.status(500).json({ error: "Failed to run task" });
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

  // ── Emotional State Engine ────────────────────────────────────────────────────

  app.get("/api/jarvis/emotional-state", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const { getEmotionalState } = await import("./intelligence/emotional-state");
      const state = await getEmotionalState(userId);
      res.json(state ?? null);
    } catch (err) {
      console.error("[emotional-state] GET failed:", err);
      res.status(500).json({ error: "Failed to load emotional state" });
    }
  });

  app.post("/api/jarvis/emotional-state/override", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const { override } = req.body;
    const validOverrides = ["calm", "focused", "in flow", "stressed", "overwhelmed"];
    if (!override || !validOverrides.includes(override)) {
      return res.status(400).json({ error: `override must be one of: ${validOverrides.join(", ")}` });
    }
    try {
      const { setManualStateOverride } = await import("./intelligence/emotional-state");
      await setManualStateOverride(userId, override, new Date());
      res.json({ ok: true, override });
    } catch (err) {
      console.error("[emotional-state] override failed:", err);
      res.status(500).json({ error: "Failed to set override" });
    }
  });

  app.post("/api/inbox/items/:id/action", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const { actionType } = req.body;
      if (!actionType) return res.status(400).json({ error: "actionType is required" });

      let telegramChatId: string | undefined;
      try {
        const [link] = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
        telegramChatId = link?.chatId;
      } catch {}

      const { executeInboxAction } = await import("./inboxActions");
      const result = await executeInboxAction(userId, id, actionType, telegramChatId);

      // Close the ego outcome loop: only resolve the proactive_message action
      // when the inbox action itself succeeded, so failed UX interactions don't
      // corrupt Ego metrics. Resolves the exact row whose metadata.sourceId
      // matches this inbox item — never bulk-updates.
      if (result.success) {
        const egoOutcome = (actionType === "dismiss" || actionType === "never_again")
          ? "dismissed"
          : "acted_on";
        db.select({ sourceId: schema.inboxItems.sourceId })
          .from(schema.inboxItems)
          .where(eq(schema.inboxItems.id, id))
          .then(([item]) => {
            if (!item?.sourceId) return;
            import("./intelligence/actionLog").then(({ resolveActionByMetadataKey }) => {
              resolveActionByMetadataKey(userId, "proactive_message", "sourceId", item.sourceId!, egoOutcome).catch(() => {});
            }).catch(() => {});
          })
          .catch(() => {});
      }

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
      const id = _p(req.params.id);
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
      const id = _p(req.params.id);
      const { active } = req.body;
      const isActive = active === true || active === "true" || active === 1;
      await db
        .update(schema.inboxRules)
        .set({ active: isActive, updatedAt: new Date() })
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
      const id = _p(req.params.id);
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
      const id = _p(req.params.id);
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
  app.get("/api/goals", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const [row] = await db
        .select({ data: schema.goals.data })
        .from(schema.goals)
        .where(eq(schema.goals.userId, userId))
        .limit(1);
      res.json({ goals: row?.data ?? [] });
    } catch (err) {
      console.error("Error fetching goals:", err);
      res.status(500).json({ error: "Failed to fetch goals" });
    }
  });

  app.post("/api/goals/:id/decompose", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const goalId = _p(req.params.id);

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
      const goalId = _p(req.params.id);
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
      const { id: jobId } = await submitAgentJob({
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

  app.get("/api/agent-jobs/active", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const jobs = await db
        .select()
        .from(schema.agentJobs)
        .where(
          and(
            eq(schema.agentJobs.userId, userId),
            sql`${schema.agentJobs.status} IN ('queued', 'running', 'cancelling')`,
          ),
        )
        .orderBy(asc(schema.agentJobs.createdAt))
        .limit(20);
      res.json(jobs);
    } catch (err) {
      console.error("Error listing active agent jobs:", err);
      res.status(500).json({ error: "Failed to list active jobs" });
    }
  });

  app.post("/api/agent-jobs/:id/cancel", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const [job] = await db
        .select()
        .from(schema.agentJobs)
        .where(and(eq(schema.agentJobs.id, id), eq(schema.agentJobs.userId, userId)))
        .limit(1);
      if (!job) return res.status(404).json({ error: "Job not found" });
      if (job.status === "complete" || job.status === "failed") {
        return res.status(400).json({ error: "Job is already finished" });
      }
      if (job.status === "cancelled" || job.status === "cancelling") {
        return res.json({ ok: true, status: job.status });
      }
      const newStatus = job.status === "queued" ? "cancelled" : "cancelling";
      await db
        .update(schema.agentJobs)
        .set({ status: newStatus, completedAt: newStatus === "cancelled" ? new Date() : undefined })
        .where(eq(schema.agentJobs.id, id));
      res.json({ ok: true, status: newStatus });
    } catch (err) {
      console.error("Error cancelling agent job:", err);
      res.status(500).json({ error: "Failed to cancel job" });
    }
  });

  app.get("/api/deliverables", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const triageSection = typeof req.query.triageSection === "string" ? req.query.triageSection : null;

      if (triageSection === "auto_handled") {
        // Return recently auto-handled / promoted-to-memory items (last 48 h)
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const items = await db
          .select()
          .from(schema.deliverables)
          .where(
            and(
              eq(schema.deliverables.userId, userId),
              eq(schema.deliverables.status, "approved"),
              gte(schema.deliverables.actedAt, since),
              sql`${schema.deliverables.triageStatus} IN ('auto_handled', 'promoted_memory')`
            )
          )
          .orderBy(desc(schema.deliverables.createdAt))
          .limit(20);
        return res.json(items);
      }

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
      const id = _p(req.params.id);
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

      // ── Approval gate: unblock the waiting agent tool call ───────────────
      if (d.type === "approval_gate") {
        const { approveGate } = await import("./agent/agentApproval");
        const meta = (d.meta as { gateId?: string }) || {};
        if (meta.gateId) await approveGate(meta.gateId, userId);
        await db
          .update(schema.deliverables)
          .set({ status: "approved", actedAt: new Date() })
          .where(eq(schema.deliverables.id, id));
        return res.json({ ok: true });
      }

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

  app.post("/api/deliverables/:id/reject", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const [d] = await db
        .select()
        .from(schema.deliverables)
        .where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.userId, userId)))
        .limit(1);
      if (!d) return res.status(404).json({ error: "Deliverable not found" });
      if (d.status !== "pending_approval") {
        return res.status(400).json({ error: "Already actioned" });
      }
      // If this is an approval gate, fire the reject event to unblock the
      // waiting tool call so it receives a "rejected" result.
      if (d.type === "approval_gate") {
        const { rejectGate } = await import("./agent/agentApproval");
        const meta = (d.meta as { gateId?: string }) || {};
        if (meta.gateId) await rejectGate(meta.gateId, userId);
      }
      await db
        .update(schema.deliverables)
        .set({ status: "rejected", actedAt: new Date() })
        .where(eq(schema.deliverables.id, id));
      res.json({ ok: true });
    } catch (err) {
      console.error("Error rejecting deliverable:", err);
      res.status(500).json({ error: "Failed to reject deliverable" });
    }
  });

  app.put("/api/deliverables/:id", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
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
      const id = _p(req.params.id);
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

  app.post("/api/deliverables/:id/save-to-drive", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const id = _p(req.params.id);
      const [d] = await db
        .select()
        .from(schema.deliverables)
        .where(and(eq(schema.deliverables.id, id), eq(schema.deliverables.userId, userId)))
        .limit(1);
      if (!d) return res.status(404).json({ error: "Deliverable not found" });
      if (d.driveLink) return res.json({ ok: true, driveLink: d.driveLink });

      const { getUserDriveSettings } = await import('./driveRoutes');
      const { createDriveTextFile } = await import('./integrations/googleDrive');
      const drive = await getUserDriveSettings(userId);
      if (!drive.enabled || !drive.accessToken) {
        return res.status(400).json({ error: "Google Drive is not connected. Enable it in Settings.", code: "DRIVE_NOT_CONNECTED" });
      }

      const content = d.body || d.summary || d.title;
      const baseName = (d.title.slice(0, 95) || "Jarvis Document").replace(/\.md$/, '');
      const fileName = `${baseName}.md`;
      const created = await createDriveTextFile(
        drive.accessToken,
        fileName,
        content,
        { folderId: drive.folderId || undefined }
      );

      const [updated] = await db
        .update(schema.deliverables)
        .set({ driveLink: created.webViewLink })
        .where(eq(schema.deliverables.id, id))
        .returning();

      res.json({ ok: true, driveLink: created.webViewLink, deliverable: updated });
    } catch (err) {
      console.error("Error saving deliverable to Drive:", err);
      res.status(500).json({ error: "Failed to save to Drive" });
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
      const id = _p(req.params.id);
      await db
        .delete(userDocuments)
        .where(and(eq(userDocuments.id, id), eq(userDocuments.userId, userId)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  app.post("/api/website-crawl", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { url } = req.body;
      if (!url || typeof url !== "string") return res.status(400).json({ error: "url is required" });
      let normalized = url.trim();
      if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
        normalized = "https://" + normalized;
      }
      const { startWebsiteCrawl } = await import("./websiteCrawler");
      const crawledAt = new Date();
      await db
        .insert(schema.websiteCrawls)
        .values({ userId, url: normalized, status: "crawling", pageCount: 0, summary: null, crawledAt })
        .onConflictDoUpdate({
          target: schema.websiteCrawls.userId,
          set: { url: normalized, status: "crawling", pageCount: 0, summary: null, crawledAt },
        });
      startWebsiteCrawl(userId, normalized).catch((err) => console.error("[website-crawl] background error:", err));
      res.json({ status: "crawling", url: normalized, pageCount: 0, summary: null, crawledAt });
    } catch (error) {
      console.error("Error starting website crawl:", error);
      res.status(500).json({ error: "Failed to start crawl" });
    }
  });

  app.get("/api/website-crawl", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(schema.websiteCrawls).where(eq(schema.websiteCrawls.userId, userId)).limit(1);
      if (rows.length === 0) return res.json({ status: "idle" });
      const row = rows[0];
      res.json({
        status: row.status,
        url: row.url,
        pageCount: row.pageCount,
        summary: row.summary,
        crawledAt: row.crawledAt,
      });
    } catch (error) {
      console.error("Error fetching website crawl:", error);
      res.status(500).json({ error: "Failed to fetch crawl status" });
    }
  });

  app.delete("/api/website-crawl", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      await db.delete(schema.websiteCrawls).where(eq(schema.websiteCrawls.userId, userId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting website crawl:", error);
      res.status(500).json({ error: "Failed to delete crawl" });
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
            model: "gpt-4o-mini",
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

  // ── Jarvis Build History — Config ────────────────────────────────────────

  app.get("/api/jarvis/builds", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const rows = await db
        .select()
        .from(schema.openclawBuildLog)
        .where(eq(schema.openclawBuildLog.userId, userId))
        .orderBy(desc(schema.openclawBuildLog.createdAt))
        .limit(50);
      res.json({ builds: rows });
    } catch (err) {
      console.error("[jarvis] GET builds failed:", err);
      res.status(500).json({ error: "Failed to load build log" });
    }
  });

  // ── Nervous System — Watch Topics ────────────────────────────────────────

  app.get("/api/nervous-system/watches", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const watches = await db
        .select()
        .from(schema.nervousSystemWatches)
        .where(eq(schema.nervousSystemWatches.userId, userId))
        .orderBy(schema.nervousSystemWatches.createdAt);
      res.json(watches);
    } catch (err) {
      console.error("[NervousSystem] watches fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch watches" });
    }
  });

  const VALID_NS_CATEGORIES = new Set(["keyword", "company", "person", "industry"]);

  app.post("/api/nervous-system/watches", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const { label, category } = req.body as { label?: string; category?: string };
    if (!label?.trim()) return res.status(400).json({ error: "label is required" });
    const cat = category && VALID_NS_CATEGORIES.has(category) ? category : "keyword";
    try {
      const [watch] = await db
        .insert(schema.nervousSystemWatches)
        .values({ userId, label: label.trim(), category: cat })
        .returning();
      res.json(watch);
    } catch (err) {
      console.error("[NervousSystem] watch create failed:", err);
      res.status(500).json({ error: "Failed to create watch" });
    }
  });

  app.patch("/api/nervous-system/watches/:id", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = _p(req.params.id);
    const { active, label, category } = req.body as { active?: boolean; label?: string; category?: string };
    try {
      const updates: Partial<typeof schema.nervousSystemWatches.$inferInsert> = {};
      if (typeof active === "boolean") updates.active = active;
      if (label?.trim()) updates.label = label.trim();
      if (category !== undefined) {
        updates.category = VALID_NS_CATEGORIES.has(category) ? category : "keyword";
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }
      const [updated] = await db
        .update(schema.nervousSystemWatches)
        .set(updates)
        .where(and(eq(schema.nervousSystemWatches.id, id), eq(schema.nervousSystemWatches.userId, userId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Watch not found" });
      res.json(updated);
    } catch (err) {
      console.error("[NervousSystem] watch update failed:", err);
      res.status(500).json({ error: "Failed to update watch" });
    }
  });

  app.delete("/api/nervous-system/watches/:id", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = _p(req.params.id);
    try {
      await db
        .delete(schema.nervousSystemWatches)
        .where(and(eq(schema.nervousSystemWatches.id, id), eq(schema.nervousSystemWatches.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("[NervousSystem] watch delete failed:", err);
      res.status(500).json({ error: "Failed to delete watch" });
    }
  });

  app.get("/api/nervous-system/signals", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const parsedLimit = parseInt((req.query.limit as string) || "20", 10);
    const limit = Math.min(50, Number.isNaN(parsedLimit) || parsedLimit < 1 ? 20 : parsedLimit);
    try {
      const signals = await db
        .select()
        .from(schema.nervousSystemSignals)
        .where(eq(schema.nervousSystemSignals.userId, userId))
        .orderBy(sql`${schema.nervousSystemSignals.createdAt} DESC`)
        .limit(limit);
      res.json(signals);
    } catch (err) {
      console.error("[NervousSystem] signals fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch signals" });
    }
  });

  // ── Jarvis Gut — Reflexive Anomaly Detection ────────────────────────────────

  app.get("/api/gut/signals", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const includeResponded = req.query.includeResponded === "true";
    const parsedLimit = parseInt((req.query.limit as string) || "50", 10);
    const limit = Math.min(100, Number.isNaN(parsedLimit) || parsedLimit < 1 ? 50 : parsedLimit);
    try {
      const { getGutSignalsForUser } = await import("./intelligence/gut");
      const signals = await getGutSignalsForUser(userId, { limit, includeResponded });
      res.json(signals);
    } catch (err) {
      console.error("[Gut] signals fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch gut signals" });
    }
  });

  app.get("/api/gut/signals/item/:itemRef", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const itemRef = _p(req.params.itemRef);
    try {
      const { getGutSignalsForUser } = await import("./intelligence/gut");
      const signals = await getGutSignalsForUser(userId, { itemRef, includeResponded: false });
      res.json(signals);
    } catch (err) {
      console.error("[Gut] item signals fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch gut signals for item" });
    }
  });

  app.post("/api/gut/signals/:id/respond", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const id = _p(req.params.id);
    const { response } = req.body as { response?: string };
    const VALID_RESPONSES = ["confirmed", "dismissed", "ignored"];
    if (!response || !VALID_RESPONSES.includes(response)) {
      return res.status(400).json({ error: "response must be confirmed, dismissed, or ignored" });
    }
    try {
      const { respondToGutSignal } = await import("./intelligence/gut");
      await respondToGutSignal(userId, id, response as schema.GutUserResponse);
      res.json({ ok: true });
    } catch (err) {
      console.error("[Gut] respond failed:", err);
      res.status(500).json({ error: "Failed to store response" });
    }
  });

  app.get("/api/gut/threat-log", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });
    const parsedLimit = parseInt((req.query.limit as string) || "30", 10);
    const limit = Math.min(100, Number.isNaN(parsedLimit) || parsedLimit < 1 ? 30 : parsedLimit);
    try {
      const rows = await db
        .select()
        .from(schema.gutSignals)
        .where(eq(schema.gutSignals.userId, userId))
        .orderBy(desc(schema.gutSignals.createdAt))
        .limit(limit);
      res.json(rows);
    } catch (err) {
      console.error("[Gut] threat-log fetch failed:", err);
      res.status(500).json({ error: "Failed to fetch threat log" });
    }
  });

  // ─── Model Preferences ────────────────────────────────────────────────────
  app.get("/api/settings/models", async (req: any, res) => {
    try {
      const userId = req.userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const { AVAILABLE_MODELS, MODEL_DEFAULTS } = await import("./lib/modelPrefs");
      const rows = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const prefs = rows[0]?.data as Record<string, unknown> | undefined;
      const stored = (prefs?.modelPreferences ?? {}) as Record<string, string>;
      const categories = Object.keys(MODEL_DEFAULTS) as Array<keyof typeof MODEL_DEFAULTS>;
      const resolved: Record<string, string> = {};
      for (const cat of categories) {
        const val = stored[cat];
        resolved[cat] = AVAILABLE_MODELS.find(m => m.value === val) ? val : MODEL_DEFAULTS[cat];
      }
      res.json({ modelPreferences: resolved, availableModels: AVAILABLE_MODELS });
    } catch (err) {
      console.error("[ModelPrefs] GET failed:", err);
      res.status(500).json({ error: "Failed to fetch model preferences" });
    }
  });

  app.patch("/api/settings/models", async (req: any, res) => {
    try {
      const userId = req.userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const { isValidModelForCategory, MODEL_DEFAULTS } = await import("./lib/modelPrefs");
      const { category, model } = req.body as { category?: string; model?: string };
      // Only OpenAI categories (chat/planning/memory/research) are permitted here;
      // the 'orchestrator' category is handled exclusively by /api/settings/orchestrator.
      const openAiCategories = Object.keys(MODEL_DEFAULTS).filter(c => c !== "orchestrator");
      if (!category || !openAiCategories.includes(category)) {
        return res.status(400).json({ error: "Invalid category" });
      }
      if (!isValidModelForCategory(model, category as import("./lib/modelPrefs").ModelCategory)) {
        return res.status(400).json({ error: "Invalid model for this category" });
      }
      const rows = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const existing = (rows[0]?.data ?? {}) as Record<string, unknown>;
      const existingModelPrefs = (existing.modelPreferences ?? {}) as Record<string, string>;
      const updated = {
        ...existing,
        modelPreferences: { ...existingModelPrefs, [category]: model },
      };
      await db
        .insert(schema.userPreferences)
        .values({ userId, data: updated })
        .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { data: updated } });
      res.json({ ok: true });
    } catch (err) {
      console.error("[ModelPrefs] PATCH failed:", err);
      res.status(500).json({ error: "Failed to save model preference" });
    }
  });

  // ─── Orchestrator settings ────────────────────────────────────────────────
  app.get("/api/settings/orchestrator", async (req: any, res) => {
    try {
      const userId = req.userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const { ORCHESTRATOR_MODELS, MODEL_DEFAULTS } = await import("./lib/modelPrefs");
      const rows = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const prefs = rows[0]?.data as Record<string, unknown> | undefined;
      const storedModel = (prefs?.modelPreferences as Record<string, string> | undefined)?.orchestrator;
      const orchestratorModel = ORCHESTRATOR_MODELS.find(m => m.value === storedModel)
        ? storedModel
        : MODEL_DEFAULTS.orchestrator;
      res.json({ orchestratorModel, availableOrchestratorModels: ORCHESTRATOR_MODELS });
    } catch (err) {
      console.error("[Orchestrator] GET failed:", err);
      res.status(500).json({ error: "Failed to fetch orchestrator settings" });
    }
  });

  app.patch("/api/settings/orchestrator", async (req: any, res) => {
    try {
      const userId = req.userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const { model } = req.body as { model?: string };
      const { ORCHESTRATOR_MODELS, MODEL_DEFAULTS } = await import("./lib/modelPrefs");
      const rows = await db
        .select({ data: schema.userPreferences.data })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      const existing = (rows[0]?.data ?? {}) as Record<string, unknown>;
      const existingModelPrefs = (existing.modelPreferences ?? {}) as Record<string, string>;
      const update: Record<string, unknown> = { ...existing };
      if (model) {
        const validModel = ORCHESTRATOR_MODELS.find(m => m.value === model)?.value ?? MODEL_DEFAULTS.orchestrator;
        update.modelPreferences = { ...existingModelPrefs, orchestrator: validModel };
      }
      await db
        .insert(schema.userPreferences)
        .values({ userId, data: update })
        .onConflictDoUpdate({ target: schema.userPreferences.userId, set: { data: update } });
      res.json({ ok: true });
    } catch (err) {
      console.error("[Orchestrator] PATCH failed:", err);
      res.status(500).json({ error: "Failed to save orchestrator settings" });
    }
  });

  // ── TTS (text-to-speech) preferences ─────────────────────────────────────
  /**
   * GET /api/settings/tts
   * Returns the user's TTS preferences: voice, enabled channels, and latency tier.
   */
  app.get("/api/settings/tts", async (req: any, res) => {
    try {
      const userId = req.userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const { getUserTtsPrefs, getUserTtsChannels } = await import("./agent/tools/tts");
      const [prefs, channels] = await Promise.all([
        getUserTtsPrefs(userId),
        getUserTtsChannels(userId),
      ]);
      return res.json({ voice: prefs.voice, latencyTier: prefs.latencyTier, ttsChannels: channels });
    } catch (err) {
      console.error("[TTS] GET settings failed:", err);
      return res.status(500).json({ error: "Failed to fetch TTS settings" });
    }
  });

  /**
   * PATCH /api/settings/tts
   * Update TTS preferences. Body fields (all optional):
   *   voice        — OpenAI voice ID or ElevenLabs voice name
   *   ttsChannels  — array of channel keys to enable auto-TTS on (e.g. ["telegram", "whatsapp"])
   *   latencyTier  — 0-4 (ElevenLabs latency tier)
   */
  app.patch("/api/settings/tts", async (req: any, res) => {
    try {
      const userId = req.userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const { setUserTtsPref, setTtsChannels } = await import("./agent/tools/tts");
      const { voice, ttsChannels, latencyTier } = req.body as {
        voice?: string;
        ttsChannels?: string[];
        latencyTier?: number;
      };

      const updates: Partial<{ voice: string; latencyTier: 0 | 1 | 2 | 3 | 4 }> = {};
      if (voice !== undefined) updates.voice = voice;
      if (latencyTier !== undefined && [0, 1, 2, 3, 4].includes(latencyTier)) {
        updates.latencyTier = latencyTier as 0 | 1 | 2 | 3 | 4;
      }
      if (Object.keys(updates).length > 0) await setUserTtsPref(userId, updates);
      if (Array.isArray(ttsChannels)) await setTtsChannels(userId, ttsChannels);

      return res.json({ ok: true });
    } catch (err) {
      console.error("[TTS] PATCH settings failed:", err);
      return res.status(500).json({ error: "Failed to save TTS settings" });
    }
  });

  /**
   * GET /api/tts/temp/:token
   * Serve a short-lived audio file (MP3) generated for WhatsApp delivery.
   * This endpoint is consumed by Twilio's media fetcher; the buffer is
   * evicted immediately after the first successful read.
   */
  app.get("/api/tts/temp/:token", (req: any, res) => {
    const { token } = req.params as { token: string };
    // consumeTempAudio is a sync function imported at module init time
    import("./agent/tools/tts").then(({ consumeTempAudio }) => {
      const entry = consumeTempAudio(token);
      if (!entry) {
        return res.status(404).json({ error: "Audio file not found or expired" });
      }
      res.setHeader("Content-Type", entry.mimeType);
      res.setHeader("Content-Length", entry.buffer.length);
      res.setHeader("Cache-Control", "no-store");
      return res.send(entry.buffer);
    }).catch(() => res.status(500).json({ error: "Internal error" }));
  });

  // ── Orchestration traces ─────────────────────────────────────────────────
  app.get("/api/orchestration-traces", async (req: any, res) => {
    try {
      const userId = req.userId as string;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const traces = await db
        .select()
        .from(schema.orchestrationTraces)
        .where(eq(schema.orchestrationTraces.userId, userId))
        .orderBy(desc(schema.orchestrationTraces.createdAt))
        .limit(20);
      res.json({ traces });
    } catch (err) {
      console.error("[Orchestrator] traces GET failed:", err);
      res.status(500).json({ error: "Failed to fetch traces" });
    }
  });

  // ── Skill endpoints ──────────────────────────────────────────────────────
  app.get("/api/skills", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { listUserSkills, getUserSkillSignals } = await import("./intelligence/skillWriter");
      const [skills, signals] = await Promise.all([
        listUserSkills(userId),
        Promise.resolve(getUserSkillSignals(userId)),
      ]);
      res.json({ skills, signals });
    } catch (err) {
      console.error("[Skills] GET /api/skills failed:", err);
      res.status(500).json({ error: "Failed to list skills" });
    }
  });

  // ── Skill Store — user-facing pack endpoints ─────────────────────────────
  /**
   * GET /api/skill-packs
   * List all store-visible packs with the current user's activation status.
   */
  app.get("/api/skill-packs", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { listStorePacksForUser } = await import("./intelligence/behaviorStore");
      const packs = await listStorePacksForUser(userId);
      res.json({ packs });
    } catch (err) {
      console.error("[SkillStore] list failed:", err);
      res.status(500).json({ error: "Failed to list skill packs" });
    }
  });

  /**
   * GET /api/skill-packs/:packId
   * Fetch a single store-visible pack with the current user's activation status.
   */
  app.get("/api/skill-packs/:packId", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const packId = _p(req.params.packId);
    try {
      const { getStorePackById } = await import("./intelligence/behaviorStore");
      const pack = await getStorePackById(packId, userId);
      if (!pack) return res.status(404).json({ error: "Pack not found" });
      res.json(pack);
    } catch (err) {
      console.error("[Routes] GET /api/skill-packs/:packId error:", err);
      res.status(500).json({ error: "Failed to fetch skill pack" });
    }
  });

  /**
   * POST /api/skill-packs/:packId/activate
   * Activate a pack for the current user.
   */
  app.post("/api/skill-packs/:packId/activate", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const packId = _p(req.params.packId);
    try {
      const { setUserPackActive } = await import("./intelligence/behaviorStore");
      await setUserPackActive(userId, packId, true);
      res.json({ ok: true });
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("not found")) return res.status(404).json({ error: msg });
      if (msg.includes("not a store-visible")) return res.status(400).json({ error: msg });
      console.error("[SkillStore] activate failed:", err);
      res.status(500).json({ error: "Failed to activate pack" });
    }
  });

  /**
   * DELETE /api/skill-packs/:packId/activate
   * Deactivate a pack for the current user.
   */
  app.delete("/api/skill-packs/:packId/activate", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const packId = _p(req.params.packId);
    try {
      const { setUserPackActive } = await import("./intelligence/behaviorStore");
      await setUserPackActive(userId, packId, false);
      res.json({ ok: true });
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("not found")) return res.status(404).json({ error: msg });
      if (msg.includes("not a store-visible")) return res.status(400).json({ error: msg });
      console.error("[SkillStore] deactivate failed:", err);
      res.status(500).json({ error: "Failed to deactivate pack" });
    }
  });

  app.delete("/api/skills/:skillId", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const skillId = _p(req.params.skillId);
    try {
      const { deleteSkill } = await import("./intelligence/skillWriter");
      const deleted = await deleteSkill(userId, skillId);
      if (!deleted) return res.status(404).json({ error: "Skill not found" });
      res.json({ ok: true });
    } catch (err) {
      console.error("[Skills] DELETE /api/skills/:skillId failed:", err);
      res.status(500).json({ error: "Failed to delete skill" });
    }
  });

  // ── User Skills (Task #502) — DB-backed personalisation skills ───────────
  // Built-in library of curated skills + user-authored custom skills.
  // Active skills are injected into Jarvis's system prompt at session start.

  const BUILT_IN_SKILLS = [
    {
      name: "Morning Ritual",
      emoji: "🌅",
      description: "Start each morning with a grounding check-in before diving into tasks.",
      instructions: "When the user first messages you in the morning (before 10 AM local time, or when context suggests it's the start of their day), open with a brief energy check: ask how they're feeling and what their top 1-3 intentions are for the day. Keep it to 2 sentences max. Only do this once per day — if they've already mentioned their day is underway, skip it. Use their answer to frame your subsequent suggestions.",
    },
    {
      name: "Finance Awareness",
      emoji: "💰",
      description: "Factor budget and financial goals into every recommendation.",
      instructions: "Before recommending any action that involves spending money, time, or resources, briefly consider whether it aligns with sensible financial habits. If the user mentions a purchase, subscription, or expense, acknowledge it and (where natural) ask if it fits their current priorities. Never lecture — one gentle nudge is enough. If the user has shared financial goals in their memory, use them as context.",
    },
    {
      name: "Stoic Coach",
      emoji: "🏛️",
      description: "Offer stoic reframes when the user is stressed or frustrated.",
      instructions: "When the user expresses frustration, anxiety, or worry, offer a brief stoic reframe: focus on what is within their control, acknowledge what is not, and suggest one concrete next action. Keep it short — two to three sentences. Do not be preachy. The goal is to help them regain agency, not to lecture. Use stoic language naturally, not as a performance.",
    },
    {
      name: "Deadline Hawk",
      emoji: "🦅",
      description: "Proactively surface deadlines and flag tasks that are running late.",
      instructions: "Always be alert to deadlines. When a task, commitment, or deliverable is mentioned, ask if it has a due date if one hasn't been provided. When you are aware of upcoming deadlines in the user's calendar or commitments, proactively surface them — especially if they are within 48 hours. Flag tasks that are approaching or past their deadline with a clear, calm heads-up, not an alarm.",
    },
    {
      name: "Deep Work Mode",
      emoji: "🎯",
      description: "Protect focus blocks and minimise interruptions during deep work.",
      instructions: "During focus blocks or when the user indicates they are in deep work mode, minimise suggestions that would break their flow. Batch non-urgent items for later review. Keep your replies short and action-oriented. If the user asks a question mid-flow, answer it concisely and return them to their task. Do not proactively surface new items or distractions during a focus session.",
    },
    {
      name: "Weekly Review",
      emoji: "📊",
      description: "Prompt a structured weekly reflection on Fridays or Sundays.",
      instructions: "On Fridays or Sundays (or when the user mentions end-of-week), prompt a brief structured review: wins from the week, open loops to close, and one key intention for the coming week. Keep the review to three questions max — do not make it feel like a chore. Help the user close out their week with clarity, not more to-dos.",
    },
    {
      name: "Gratitude Practice",
      emoji: "🙏",
      description: "Gently invite the user to note one thing they're grateful for each day.",
      instructions: "Once per day, find a natural moment to briefly invite the user to name one thing they are grateful for. Keep the prompt to a single sentence and make it feel light, not mandatory. Warmly acknowledge their response with a single sentence. Never push if they seem busy or decline — skip it and try again another time.",
    },
    {
      name: "Fitness Check-in",
      emoji: "💪",
      description: "Suggest movement and breaks when energy or wellbeing seems low.",
      instructions: "When the user mentions feeling tired, drained, or stuck, gently ask if they have moved their body today. Suggest short movement breaks (a 5-minute walk, stretching) when patterns suggest they have been sitting for a long time. Keep suggestions brief — one sentence. Do not nag. If they have already exercised or decline, acknowledge it and move on.",
    },
    {
      name: "Communication Filter",
      emoji: "🔍",
      description: "Help the user communicate clearly and with the right tone.",
      instructions: "When reviewing or helping draft emails, messages, or important communications, pay attention to tone, clarity, and potential for misinterpretation. If you notice something that might land poorly or be unclear, note it briefly before sending — one sentence is enough. Suggest one concrete improvement if needed. The goal is thoughtful communication, not perfection.",
    },
    {
      name: "Energy Management",
      emoji: "⚡",
      description: "Protect the user's peak hours and help them manage energy across the day.",
      instructions: "Pay attention to mentions of the user's energy levels across conversations. When they seem depleted, suggest tackling their most important work during peak hours (usually morning for most people) and protecting those times from meetings and reactive tasks. Gently remind them that rest is productive. When they mention being overwhelmed, suggest doing one thing at a time rather than multitasking.",
    },
  ];

  /**
   * GET /api/user-skills
   * Returns all skills for this user (built-in seeded + custom). Seeds the
   * built-in library on first call for new users.
   */
  app.get("/api/user-skills", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { userSkills } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      const existing = await db.select().from(userSkills).where(eq(userSkills.userId, userId));

      // Seed built-in skills on first visit (idempotent: onConflictDoNothing guards
      // the partial unique index user_skills_builtin_name_uniq so concurrent
      // first-time requests cannot create duplicate built-ins).
      const existingBuiltInNames = new Set(
        existing.filter((s) => s.isBuiltIn).map((s) => s.name),
      );
      const toSeed = BUILT_IN_SKILLS.filter((s) => !existingBuiltInNames.has(s.name));
      if (toSeed.length > 0) {
        await db
          .insert(userSkills)
          .values(
            toSeed.map((s) => ({
              userId,
              name: s.name,
              emoji: s.emoji,
              description: s.description,
              instructions: s.instructions,
              isBuiltIn: true,
              isActive: false,
            })),
          )
          .onConflictDoNothing();
        const fresh = await db.select().from(userSkills).where(eq(userSkills.userId, userId));
        return res.json({ skills: fresh });
      }

      res.json({ skills: existing });
    } catch (err) {
      console.error("[UserSkills] GET failed:", err);
      res.status(500).json({ error: "Failed to list skills" });
    }
  });

  /**
   * POST /api/user-skills
   * Create a new custom skill.
   */
  app.post("/api/user-skills", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { name, emoji, description, instructions } = req.body as {
      name?: string;
      emoji?: string;
      description?: string;
      instructions?: string;
    };
    if (!name || !instructions) {
      return res.status(400).json({ error: "name and instructions are required" });
    }
    try {
      const { userSkills } = await import("@shared/schema");
      const [skill] = await db
        .insert(userSkills)
        .values({
          userId,
          name: name.trim().slice(0, 80),
          emoji: (emoji ?? "⚡").slice(0, 8),
          description: (description ?? "").trim().slice(0, 200),
          instructions: instructions.trim().slice(0, 3000),
          isBuiltIn: false,
          isActive: true,
        })
        .returning();
      res.status(201).json({ skill });
    } catch (err) {
      console.error("[UserSkills] POST failed:", err);
      res.status(500).json({ error: "Failed to create skill" });
    }
  });

  /**
   * PATCH /api/user-skills/:id/toggle
   * Toggle a skill's isActive state.
   */
  app.patch("/api/user-skills/:id/toggle", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = _p(req.params.id);
    try {
      const { userSkills } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [existing] = await db
        .select()
        .from(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Skill not found" });
      const [updated] = await db
        .update(userSkills)
        .set({ isActive: !existing.isActive, updatedAt: new Date() })
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .returning();
      res.json({ skill: updated });
    } catch (err) {
      console.error("[UserSkills] PATCH toggle failed:", err);
      res.status(500).json({ error: "Failed to toggle skill" });
    }
  });

  /**
   * PATCH /api/user-skills/:id
   * Update name, description, instructions, and/or emoji for a custom skill.
   * Built-in skills cannot be modified via this endpoint.
   */
  app.patch("/api/user-skills/:id", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = _p(req.params.id);
    const { name, description, instructions, emoji } = req.body as {
      name?: string; description?: string; instructions?: string; emoji?: string;
    };
    try {
      const { userSkills } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [existing] = await db
        .select()
        .from(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Skill not found" });
      if (existing.isBuiltIn) return res.status(400).json({ error: "Built-in skills cannot be modified" });
      const updates: Partial<typeof existing> = {};
      if (name?.trim()) updates.name = name.trim().slice(0, 80);
      if (description !== undefined) updates.description = description.trim().slice(0, 200);
      if (instructions?.trim()) updates.instructions = instructions.trim().slice(0, 3000);
      if (emoji?.trim()) updates.emoji = emoji.trim().slice(0, 8);
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No fields to update" });
      const [updated] = await db
        .update(userSkills)
        .set(updates)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .returning();
      res.json({ skill: updated });
    } catch (err) {
      console.error("[UserSkills] PATCH update failed:", err);
      res.status(500).json({ error: "Failed to update skill" });
    }
  });

  /**
   * DELETE /api/user-skills/:id
   * Delete a custom skill (built-in skills cannot be deleted).
   */
  app.delete("/api/user-skills/:id", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = _p(req.params.id);
    try {
      const { userSkills } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [existing] = await db
        .select()
        .from(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)))
        .limit(1);
      if (!existing) return res.status(404).json({ error: "Skill not found" });
      if (existing.isBuiltIn) return res.status(400).json({ error: "Built-in skills cannot be deleted" });
      await db
        .delete(userSkills)
        .where(and(eq(userSkills.id, id), eq(userSkills.userId, userId)));
      res.json({ ok: true });
    } catch (err) {
      console.error("[UserSkills] DELETE failed:", err);
      res.status(500).json({ error: "Failed to delete skill" });
    }
  });

  // ── Skill Candidates (Task #872) ────────────────────────────────────────
  // Routes are registered at both the canonical path (/api/skills/candidates)
  // and the legacy path (/api/skill-candidates) for backward compatibility.
  /**
   * GET /api/skills/candidates   (canonical)
   * GET /api/skill-candidates    (legacy alias)
   * Returns all pending skill candidates for the authenticated user.
   */
  const skillCandidatesGetHandler = async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { skillCandidates } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(skillCandidates)
        .where(and(eq(skillCandidates.userId, userId), eq(skillCandidates.status, "pending")))
        .orderBy(skillCandidates.createdAt);
      res.json({ candidates: rows });
    } catch (err) {
      console.error("[SkillCandidates] GET failed:", err);
      res.status(500).json({ error: "Failed to list skill candidates" });
    }
  };
  app.get("/api/skills/candidates", skillCandidatesGetHandler);
  app.get("/api/skill-candidates", skillCandidatesGetHandler);

  /**
   * PATCH /api/skills/candidates/:id/review  (canonical)
   * PATCH /api/skill-candidates/:id/review   (legacy alias)
   * Accept, edit, or dismiss a skill candidate.
   * Body: { action: "accept" | "edit" | "dismiss", name?, instructionText? }
   * On accept/edit, a user_skills row is inserted (isActive=true).
   */
  const skillCandidatesReviewHandler = async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = _p(req.params.id);
    const { action, name, instructionText } = req.body as {
      action?: string;
      name?: string;
      instructionText?: string;
    };
    if (!action || !["accept", "edit", "dismiss"].includes(action)) {
      return res.status(400).json({ error: "action must be accept, edit, or dismiss" });
    }
    try {
      const { skillCandidates, userSkills } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [candidate] = await db
        .select()
        .from(skillCandidates)
        .where(and(eq(skillCandidates.id, id), eq(skillCandidates.userId, userId)))
        .limit(1);
      if (!candidate) return res.status(404).json({ error: "Candidate not found" });
      if (candidate.status !== "pending") {
        return res.status(409).json({ error: "Candidate has already been reviewed" });
      }

      const newStatus = action === "accept" ? "accepted" : action === "edit" ? "edited" : "dismissed";

      // Perform status update and optional skill insertion atomically so a
      // partial failure never leaves a candidate marked reviewed without a
      // corresponding user_skills row.
      await db.transaction(async (tx) => {
        await tx
          .update(skillCandidates)
          .set({ status: newStatus })
          .where(eq(skillCandidates.id, id));

        if (action === "accept" || action === "edit") {
          const finalName = name?.trim() ? name.trim().slice(0, 80) : candidate.name;
          const finalInstructions = instructionText?.trim()
            ? instructionText.trim().slice(0, 3000)
            : candidate.instructionText;
          await tx.insert(userSkills).values({
            userId,
            name: finalName,
            emoji: "⚡",
            description: candidate.triggerDescription.slice(0, 200),
            instructions: finalInstructions,
            isBuiltIn: false,
            isActive: true,
          });
        }
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("[SkillCandidates] PATCH review failed:", err);
      res.status(500).json({ error: "Failed to review candidate" });
    }
  };
  app.patch("/api/skills/candidates/:id/review", skillCandidatesReviewHandler);
  app.patch("/api/skill-candidates/:id/review", skillCandidatesReviewHandler);

  // ── Integration pre-flight status ────────────────────────────────────────
  // Returns a map of { integration → { status, errorMessage, expiresAt, lastCheckedAt } }
  // for the authenticated user. Used by the Settings screen to show health badges.
  app.get("/api/integrations/status", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { db } = await import("./db");
      const { integrationStatus } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(integrationStatus)
        .where(eq(integrationStatus.userId, userId));

      // All integrations the app supports — returned as unconfigured by default
      // so the UI always has a complete picture even before the first validator pass.
      const KNOWN_INTEGRATIONS = [
        "google", "outlook", "telegram", "discord", "slack", "whatsapp",
      ] as const;

      const now = new Date().toISOString();
      const result: Record<string, {
        status: string;
        errorMessage: string | null;
        expiresAt: string | null;
        lastCheckedAt: string;
      }> = {};
      for (const key of KNOWN_INTEGRATIONS) {
        result[key] = { status: "unconfigured", errorMessage: null, expiresAt: null, lastCheckedAt: now };
      }
      for (const row of rows) {
        result[row.integration] = {
          status: row.status,
          errorMessage: row.errorMessage ?? null,
          expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
          lastCheckedAt: row.lastCheckedAt.toISOString(),
        };
      }
      res.json(result);
    } catch (err) {
      console.error("[Integrations] GET /api/integrations/status failed:", err);
      res.status(500).json({ error: "Failed to fetch integration statuses" });
    }
  });

  // Trigger an immediate re-check for the current user (called after reconnect).
  app.post("/api/integrations/refresh", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { validateUserIntegrations } = await import("./intelligence/integrationValidator");
      await validateUserIntegrations(userId);
      res.json({ ok: true });
    } catch (err) {
      console.error("[Integrations] POST /api/integrations/refresh failed:", err);
      res.status(500).json({ error: "Failed to refresh integration statuses" });
    }
  });

  // ── Diagnostics ──────────────────────────────────────────────────────────────

  app.get("/api/diagnostics/health", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { runHealthCheck } = await import("./diagnostics/diagnosticsService");
      const report = await runHealthCheck(userId);
      res.json(report);
    } catch (err) {
      console.error("[Diagnostics] GET /api/diagnostics/health failed:", err);
      res.status(500).json({ error: "Failed to run health check" });
    }
  });

  app.post("/api/diagnostics/run", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { runAIDiagnosis } = await import("./diagnostics/diagnosticsService");
      const { diagnosis, report } = await runAIDiagnosis(userId);
      res.json({ diagnosis, report });
    } catch (err) {
      console.error("[Diagnostics] POST /api/diagnostics/run failed:", err);
      res.status(500).json({ error: "Failed to run diagnosis" });
    }
  });

  app.get("/api/diagnostics/memory-events", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { getRecentEvents } = await import("./diagnostics/diagnosticsService");
      const events = await getRecentEvents({
        userId,
        subsystem: "memory",
        limit: 20,
        sinceMinutes: 60,
        excludePatternDetected: true,
      });
      res.json(events);
    } catch (err) {
      console.error("[Diagnostics] GET /api/diagnostics/memory-events failed:", err);
      res.status(500).json({ error: "Failed to fetch memory events" });
    }
  });

  app.get("/api/diagnostics/events", async (req: Request, res: Response) => {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const subsystem = typeof req.query.subsystem === "string" ? req.query.subsystem : undefined;
    if (!subsystem) return res.status(400).json({ error: "subsystem query param required" });
    const validSubsystems: readonly string[] = schema.DIAGNOSTIC_SUBSYSTEMS;
    if (!validSubsystems.includes(subsystem)) {
      return res.status(400).json({ error: `Invalid subsystem. Must be one of: ${schema.DIAGNOSTIC_SUBSYSTEMS.join(", ")}` });
    }
    try {
      const { getRecentEvents } = await import("./diagnostics/diagnosticsService");
      const events = await getRecentEvents({
        userId,
        subsystem: subsystem as import("@shared/schema").DiagnosticSubsystem,
        limit: 20,
        sinceMinutes: 60,
        excludePatternDetected: true,
      });
      res.json(events);
    } catch (err) {
      console.error("[Diagnostics] GET /api/diagnostics/events failed:", err);
      res.status(500).json({ error: "Failed to fetch subsystem events" });
    }
  });

  // ── Local Worker API ────────────────────────────────────────────────────────
  // Allows a worker process running on the user's PC to receive transcript
  // jobs, fetch them locally (with yt-dlp or any other method), and return
  // results. This bypasses IP-level blocks YouTube applies to cloud providers.

  /** GET /api/local-worker/token
   *  Returns (or generates) the current user's local-worker auth token.
   *  Requires normal session auth. */
  app.get("/api/local-worker/token", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { getOrCreateWorkerToken } = await import("./lib/localWorkerQueue");
    const token = getOrCreateWorkerToken(userId);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json({
      token,
      instructions: {
        poll: `GET  ${baseUrl}/api/local-worker/jobs/next?token=${token}`,
        complete: `POST ${baseUrl}/api/local-worker/jobs/:id/complete?token=${token}`,
        fail: `POST ${baseUrl}/api/local-worker/jobs/:id/fail?token=${token}`,
        heartbeat: `POST ${baseUrl}/api/local-worker/heartbeat?token=${token}`,
      },
    });
  });

  /** POST /api/local-worker/heartbeat?token=XXX
   *  Keep-alive ping from the local worker. Must be called at least once every
   *  2 minutes for the server to consider the worker online. */
  app.post("/api/local-worker/heartbeat", async (req: Request, res: Response) => {
    const token = String(req.query.token || req.body?.token || "");
    if (!token) return res.status(400).json({ error: "token required" });
    const { heartbeat } = await import("./lib/localWorkerQueue");
    if (!heartbeat(token)) return res.status(401).json({ error: "invalid token" });
    res.json({ ok: true });
  });

  /** GET /api/local-worker/jobs/next?token=XXX
   *  Claim the next pending job for the worker. Returns 204 when there is
   *  nothing to do (worker should poll again in a few seconds). */
  app.get("/api/local-worker/jobs/next", async (req: Request, res: Response) => {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).json({ error: "token required" });
    const { claimNextJob } = await import("./lib/localWorkerQueue");
    const job = claimNextJob(token);
    if (!job) return res.status(204).end();
    res.json(job);
  });

  /** POST /api/local-worker/jobs/:id/complete?token=XXX
   *  Submit transcript segments for a completed job.
   *  Body: { segments: Array<{ text, offset, duration }> } */
  app.post("/api/local-worker/jobs/:id/complete", async (req: Request, res: Response) => {
    const token = String(req.query.token || req.body?.token || "");
    const jobId = _p(req.params.id);
    if (!token || !jobId) return res.status(400).json({ error: "token and id required" });
    const segments = req.body?.segments;
    if (!Array.isArray(segments)) return res.status(400).json({ error: "segments array required" });
    const { completeJob } = await import("./lib/localWorkerQueue");
    if (!completeJob(jobId, token, segments)) {
      return res.status(404).json({ error: "job not found or token mismatch" });
    }
    res.json({ ok: true });
  });

  /** POST /api/local-worker/jobs/:id/fail?token=XXX
   *  Report a job failure from the local worker.
   *  Body: { error: "description" } */
  app.post("/api/local-worker/jobs/:id/fail", async (req: Request, res: Response) => {
    const token = String(req.query.token || req.body?.token || "");
    const jobId = _p(req.params.id);
    if (!token || !jobId) return res.status(400).json({ error: "token and id required" });
    const error = String(req.body?.error || "unknown error");
    const { failJob } = await import("./lib/localWorkerQueue");
    if (!failJob(jobId, token, error)) {
      return res.status(404).json({ error: "job not found or token mismatch" });
    }
    res.json({ ok: true });
  });

  /** POST /api/local-worker/transcribe-audio?token=XXX
   *  Transcribes audio uploaded by the local worker using OpenAI Whisper.
   *  The local worker downloads YouTube audio on the user's PC (no IP blocks),
   *  encodes it as base64, then posts here for AI transcription.
   *  Body: { audio: "<base64>", format: "mp3"|"wav"|"m4a", videoId?: string } */
  app.post("/api/local-worker/transcribe-audio", async (req: Request, res: Response) => {
    const token = String(req.query.token || req.body?.token || "");
    if (!token) return res.status(400).json({ error: "token required" });

    // Validate token — any registered worker token is accepted
    const { getUserIdByToken } = await import("./lib/localWorkerQueue");
    const userId = getUserIdByToken(token);
    if (!userId) return res.status(401).json({ error: "invalid token" });

    const audioB64 = req.body?.audio as string | undefined;
    const format = (req.body?.format as string | undefined) || "mp3";
    if (!audioB64) return res.status(400).json({ error: "audio (base64) required" });

    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      return res.status(503).json({ error: "OpenAI API not configured" });
    }

    try {
      const audioBuffer = Buffer.from(audioB64, "base64");
      // Enforce 25 MB Whisper API limit
      if (audioBuffer.length > 25 * 1024 * 1024) {
        return res.status(413).json({ error: "Audio chunk exceeds 25 MB Whisper limit — split into smaller chunks" });
      }

      const { openai } = await import("./replit_integrations/audio/client");
      const { toFile } = await import("openai");
      const safeFormat = ["mp3", "wav", "m4a", "webm", "mp4", "ogg"].includes(format) ? format : "mp3";
      const file = await toFile(audioBuffer, `audio.${safeFormat}`, { type: `audio/${safeFormat}` });
      const response = await openai.audio.transcriptions.create({
        file,
        model: "whisper-1",
        language: "en",
        response_format: "text",
      });
      const transcript = typeof response === "string" ? response : ((response as { text?: string }).text ?? "");
      res.json({ ok: true, transcript });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[local-worker/transcribe-audio] error for user ${userId}: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  // ── MCP server management ────────────────────────────────────────────────────

  /** GET /api/mcp-servers/prompts — list MCP prompt templates across all connected servers for the user. */
  app.get("/api/mcp-servers/prompts", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { mcpServerRegistry } = await import("./agent/mcp/mcpServerRegistry");
      const prompts = await mcpServerRegistry.listPromptsForUser(userId);
      res.json({
        prompts: prompts.map((entry) => ({
          serverName: entry.serverName,
          serverId: entry.serverId,
          name: entry.prompt.name,
          description: entry.prompt.description,
          arguments: entry.prompt.arguments ?? [],
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/mcp-servers/prompts/resolve — expand a prompt template to its rendered text. */
  app.post("/api/mcp-servers/prompts/resolve", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { serverId, name, args } = req.body as { serverId: string; name: string; args?: Record<string, string> };
    if (!serverId || !name) return res.status(400).json({ error: "serverId and name are required" });
    try {
      const { mcpServerRegistry } = await import("./agent/mcp/mcpServerRegistry");
      const client = mcpServerRegistry.getClientForUser(userId, serverId);
      if (!client) return res.status(404).json({ error: "MCP server not found or not accessible" });
      const result = await client.getPrompt(name, args);
      // Collapse all message text parts into a single resolved prompt string
      const resolvedText = result.messages
        .map(m => (typeof m.content === 'object' && 'text' in m.content ? m.content.text ?? '' : ''))
        .filter(Boolean)
        .join('\n\n');
      res.json({ resolvedText: resolvedText || name, description: result.description });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /** GET /api/settings/env-var-check?key=VAR_NAME — reports whether a named env var is present.
   *  Only accepts conventional env var names (uppercase letters, digits, underscores) so the
   *  endpoint cannot be used to enumerate arbitrary process state.
   */
  app.get("/api/settings/env-var-check", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
    if (!key) return res.status(400).json({ error: "key query param is required" });
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key)) {
      return res.status(400).json({ error: "key must be a valid env var name (uppercase letters, digits, underscores; max 128 chars)" });
    }
    const { envVarPresent } = await import("./lib/credentialResolver");
    res.json({ present: envVarPresent(key) });
  });

  /** GET /api/mcp-servers — list MCP servers visible to the current user. */
  app.get("/api/mcp-servers", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const { mcpServerRegistry } = await import("./agent/mcp/mcpServerRegistry");
      const statuses = mcpServerRegistry.getStatusForUser(userId);
      res.json({
        servers: statuses.map((s) => ({
          id: s.server.id,
          name: s.server.name,
          transport: s.server.transport,
          command: s.server.command,
          url: s.server.url,
          enabled: s.server.enabled,
          isBuiltIn: s.server.isBuiltIn,
          connected: s.connected,
          toolCount: s.toolCount,
          error: s.error,
          isSystem: s.server.userId === null,
          credentialMode: s.server.credentialMode ?? "direct",
          envKey: s.server.envKey ?? null,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/mcp-servers — add a new MCP server. */
  app.post("/api/mcp-servers", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { name, transport, command, url, authToken, credentialMode, envKey } = req.body as {
      name?: string;
      transport?: string;
      command?: string;
      url?: string;
      authToken?: string;
      credentialMode?: string;
      envKey?: string;
    };
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }
    const transport2 = transport === "http" ? "http" : "stdio";
    if (transport2 === "stdio" && !command) {
      return res.status(400).json({ error: "command is required for stdio transport" });
    }
    if (transport2 === "http" && !url) {
      return res.status(400).json({ error: "url is required for http transport" });
    }
    const mode = credentialMode === "env-ref" ? "env-ref" : "direct";
    if (transport2 === "http" && mode === "env-ref") {
      const key = envKey?.trim() ?? "";
      if (!key) {
        return res.status(400).json({ error: "envKey is required when credentialMode is env-ref" });
      }
      if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key)) {
        return res.status(400).json({ error: "envKey must be a valid env var name (uppercase letters, digits, underscores; max 128 chars)" });
      }
    }
    try {
      const { mcpServerRegistry } = await import("./agent/mcp/mcpServerRegistry");
      const row = await mcpServerRegistry.addServer({
        userId,
        name: name.trim().slice(0, 80),
        transport: transport2,
        command: command ?? null,
        url: url ?? null,
        authToken: mode === "direct" ? (authToken ?? null) : null,
        credentialMode: mode,
        envKey: mode === "env-ref" ? (envKey?.trim() ?? null) : null,
        enabled: true,
        isBuiltIn: false,
      });
      res.status(201).json({ ok: true, id: row.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[MCP API] addServer failed:", msg);
      res.status(500).json({ error: msg });
    }
  });

  /** DELETE /api/mcp-servers/:id — remove a user-owned MCP server. */
  app.delete("/api/mcp-servers/:id", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = _p(req.params.id);
    try {
      const { mcpServerRegistry } = await import("./agent/mcp/mcpServerRegistry");
      const deleted = await mcpServerRegistry.deleteServer(id, userId);
      if (!deleted) return res.status(404).json({ error: "Server not found or not owned by you" });
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /** PATCH /api/mcp-servers/:id/enabled — toggle a server on/off. */
  app.patch("/api/mcp-servers/:id/enabled", async (req: Request, res: Response) => {
    const userId = (req as any).userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = _p(req.params.id);
    const { enabled } = req.body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }
    try {
      const { mcpServerRegistry } = await import("./agent/mcp/mcpServerRegistry");
      await mcpServerRegistry.setEnabled(id, enabled);
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── MCP API Key Management ────────────────────────────────────────────────
  /** GET /api/mcp-key — return key info (prefix, created_at) for the current user. */
  app.get("/api/mcp-key", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    try {
      const { getMcpKeyInfo } = await import("./agent/mcp/mcpApiKeys");
      const info = await getMcpKeyInfo(userId);
      if (!info) return res.json({ hasKey: false });
      res.json({ hasKey: true, prefix: info.prefix, createdAt: info.createdAt, lastUsedAt: info.lastUsedAt });
    } catch (err) {
      res.status(500).json({ error: "Failed to get key info" });
    }
  });

  /** POST /api/mcp-key/generate — create a new API key (revokes any existing). */
  app.post("/api/mcp-key/generate", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    try {
      const { generateMcpApiKey } = await import("./agent/mcp/mcpApiKeys");
      const { rawKey, prefix } = await generateMcpApiKey(userId);
      res.json({ rawKey, prefix });
    } catch (err) {
      res.status(500).json({ error: "Failed to generate key" });
    }
  });

  /** DELETE /api/mcp-key — revoke all MCP API keys for the current user. */
  app.delete("/api/mcp-key", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    try {
      const { revokeMcpApiKeys } = await import("./agent/mcp/mcpApiKeys");
      await revokeMcpApiKeys(userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to revoke keys" });
    }
  });

  /** POST /api/mcp — Jarvis MCP server endpoint (Streamable HTTP transport). */
  // No authMiddleware — uses MCP API key from Authorization: Bearer header.
  app.post("/api/mcp", async (req: Request, res: Response) => {
    const { handleMcpRequest } = await import("./agent/mcp/mcpServerHandler");
    await handleMcpRequest(req, res);
  });

  // ── Voice Realtime API ────────────────────────────────────────────────────

  /**
   * GET /api/voice/realtime-session
   * Returns relay availability status. Lets the mobile client check whether the
   * server-side WebSocket relay is configured before attempting a connection.
   */
  app.get("/api/voice/realtime-session", authMiddleware, (_req: Request, res: Response) => {
    const relayAvailable = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
    res.json({
      relay_available: relayAvailable,
      relay_url: "/api/voice/ws",
      model: "gpt-4o-realtime-preview-2024-12-17",
    });
  });

  /**
   * POST /api/voice/relay-ticket
   * Issues a short-lived (30 s), single-use relay ticket for the authenticated user.
   * The native client uses this ticket to open the relay WebSocket without embedding
   * the long-lived JWT in the WebSocket URL (which would appear in server logs/proxies).
   */
  app.post("/api/voice/relay-ticket", authMiddleware, (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    import("./voiceRelayRoutes").then(({ createRelayTicket }) => {
      const ticket = createRelayTicket(userId);
      res.json({ ticket, ttl_seconds: 30 });
    }).catch(() => {
      res.status(503).json({ error: "Voice relay not available" });
    });
  });

  /**
   * POST /api/voice/realtime-session
   * Mints a short-lived OpenAI Realtime API ephemeral client secret for WebRTC/WebSocket.
   * The secret expires in ~60 seconds and is scoped to a single session.
   */
  app.post("/api/voice/realtime-session", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    try {
      const { buildJarvisInstructions } = await import('./voiceRelayRoutes');
      const instructions = await buildJarvisInstructions(userId);
      const openaiBase = (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/v1\/?$/, '');
      const sessionRes = await fetch(`${openaiBase}/v1/realtime/sessions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-realtime-preview-2024-12-17',
          voice: 'verse',
          instructions,
          tools: [
            {
              type: 'function',
              name: 'get_today_summary',
              description: "Get the user's tasks and upcoming scheduled items for today",
              parameters: { type: 'object', properties: {} },
            },
            {
              type: 'function',
              name: 'search_memories',
              description: "Search the user's personal memories and knowledge base",
              parameters: {
                type: 'object',
                properties: { query: { type: 'string', description: 'The search query' } },
                required: ['query'],
              },
            },
          ],
          tool_choice: 'auto',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600,
          },
        }),
      });

      if (!sessionRes.ok) {
        const errText = await sessionRes.text().catch(() => sessionRes.statusText);
        console.error(`[voice/realtime-session] OpenAI error ${sessionRes.status}:`, errText);
        return res.status(502).json({ error: 'Failed to create realtime session' });
      }

      const session = await sessionRes.json() as Record<string, unknown>;
      console.log(`[voice/realtime-session] Session ${session.id} created for user ${userId}`);
      res.json({ client_secret: session.client_secret, session_id: session.id });
    } catch (err) {
      console.error('[voice/realtime-session] Error:', err);
      res.status(500).json({ error: 'Failed to create realtime session' });
    }
  });

  /**
   * POST /api/voice/tool-call
   * Executes a named tool from a Realtime voice session and returns the result.
   * The Realtime API sends function_call events; the client POSTs here and relays
   * the result back to the session data channel.
   */
  app.post("/api/voice/tool-call", authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    const { tool_name, arguments: toolArgs } = req.body || {};
    try {
      if (tool_name === 'get_today_summary') {
        const today = new Date().toISOString().slice(0, 10);
        const tasks = await db
          .select({
            id: schema.jarvisScheduledTasks.id,
            title: schema.jarvisScheduledTasks.title,
            scheduledAt: schema.jarvisScheduledTasks.scheduledAt,
            completedAt: schema.jarvisScheduledTasks.completedAt,
          })
          .from(schema.jarvisScheduledTasks)
          .where(
            and(
              eq(schema.jarvisScheduledTasks.userId, userId),
              sql`DATE(${schema.jarvisScheduledTasks.scheduledAt}) = ${today}`,
            )
          )
          .limit(10);
        return res.json({
          result: JSON.stringify({
            date: today,
            tasks: tasks.map(t => ({
              title: t.title,
              scheduledAt: t.scheduledAt,
              done: !!t.completedAt,
            })),
          }),
        });
      }

      if (tool_name === 'search_memories') {
        const query = String((toolArgs as Record<string, unknown>)?.query || '').trim();
        const { retrieveRelevantMemories } = await import('./memory/retrieve');
        const memories = await retrieveRelevantMemories(userId, query, 5);
        return res.json({
          result: JSON.stringify({
            memories: memories.map((m: { content: string; category: string }) => ({
              content: m.content,
              category: m.category,
            })),
          }),
        });
      }

      return res.json({ result: JSON.stringify({ error: `Unknown tool: ${tool_name}` }) });
    } catch (err) {
      console.error('[voice/tool-call] Error:', err);
      res.status(500).json({ error: 'Tool execution failed' });
    }
  });

  /**
   * POST /api/conversations
   * Create a new voice/audio conversation thread.
   */
  app.post("/api/conversations", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { chatStorage } = await import('./replit_integrations/chat/storage');
      const { title } = req.body || {};
      const conversation = await chatStorage.createConversation(title || 'Voice Session');
      res.status(201).json(conversation);
    } catch (err) {
      console.error('[conversations] create error:', err);
      res.status(500).json({ error: 'Failed to create conversation' });
    }
  });

  /**
   * POST /api/conversations/:id/voice-transcript
   * Save an array of voice transcript entries to a conversation.
   * Body: { entries: Array<{ role: 'user' | 'assistant'; text: string }> }
   */
  app.post("/api/conversations/:id/voice-transcript", authMiddleware, async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(_p(req.params.id), 10);
      const entries: Array<{ role: string; text: string }> = req.body?.entries || [];
      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'entries array is required' });
      }
      const { chatStorage } = await import('./replit_integrations/chat/storage');
      for (const entry of entries) {
        if (entry.role && entry.text) {
          await chatStorage.createMessage(conversationId, entry.role, entry.text);
        }
      }
      res.json({ ok: true, saved: entries.length });
    } catch (err) {
      console.error('[conversations/voice-transcript] error:', err);
      res.status(500).json({ error: 'Failed to save transcript' });
    }
  });

  // ── Write-budget endpoints ──────────────────────────────────────────────────
  // GET  /api/write-budget        — returns current count, max, and tripped state.
  // POST /api/write-budget/reset  — owner-only; clears the circuit-breaker counter.

  app.get("/api/write-budget", authMiddleware, async (req: Request, res: Response) => {
    try {
      const {
        checkCircuitBreaker,
        CIRCUIT_MAX_WRITES,
        writeBudgetSummary,
      } = await import("./agent/safeWritePolicy");
      const [status, summary] = await Promise.all([checkCircuitBreaker(), writeBudgetSummary()]);
      res.json({
        count:   status.count,
        max:     CIRCUIT_MAX_WRITES,
        tripped: status.tripped,
        resetAt: status.resetAt?.toISOString() ?? null,
        summary,
      });
    } catch (err) {
      console.error("[write-budget] GET error:", err);
      res.status(500).json({ error: "Failed to fetch write budget" });
    }
  });

  app.post("/api/write-budget/reset", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!(await isIntegrationOwner(userId))) {
        return res.status(403).json({ error: "Only the account owner can reset the write budget" });
      }
      const { resetCircuitBreaker } = await import("./agent/safeWritePolicy");
      await resetCircuitBreaker();
      res.json({ ok: true });
    } catch (err) {
      console.error("[write-budget] POST /reset error:", err);
      res.status(500).json({ error: "Failed to reset write budget" });
    }
  });

  // ── Self-heal audit log API ───────────────────────────────────────────────
  app.get("/api/self-heal-audit", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      if (!(await isIntegrationOwner(userId))) {
        return res.status(403).json({ error: "Only the account owner can view the self-heal audit log" });
      }
      const parsedLimit = parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isNaN(parsedLimit) ? 50 : Math.max(1, Math.min(parsedLimit, 200));
      const entries = await db
        .select()
        .from(schema.selfHealAuditLog)
        .orderBy(desc(schema.selfHealAuditLog.createdAt))
        .limit(limit);
      res.json({ entries });
    } catch (err) {
      console.error("[self-heal-audit] GET error:", err);
      res.status(500).json({ error: "Failed to fetch self-heal audit log" });
    }
  });

  // ── Button locations — trained button memory ────────────────────────────
  app.get("/api/button-locations", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const rows = await db.select().from(schema.buttonLocations)
        .where(eq(schema.buttonLocations.userId, userId))
        .orderBy(desc(schema.buttonLocations.updatedAt));
      res.json({ entries: rows });
    } catch (err) {
      console.error("[button-locations] GET error:", err);
      res.status(500).json({ error: "Failed to fetch button locations" });
    }
  });

  app.post("/api/button-locations", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { appPackage, screenContext, elementLabel, coordinatesX, coordinatesY, screenshotHash, screenshotPath } = req.body;
      if (!appPackage || !elementLabel || coordinatesX == null || coordinatesY == null) {
        return res.status(400).json({ error: "appPackage, elementLabel, coordinatesX, coordinatesY are required" });
      }
      const [row] = await db.insert(schema.buttonLocations).values({
        userId,
        appPackage: String(appPackage),
        screenContext: String(screenContext || ""),
        elementLabel: String(elementLabel),
        coordinatesX: Number(coordinatesX),
        coordinatesY: Number(coordinatesY),
        screenshotHash: screenshotHash ? String(screenshotHash) : null,
        screenshotPath: screenshotPath ? String(screenshotPath) : null,
        confidence: 0.5,
      }).returning();
      res.json({ entry: row });
    } catch (err) {
      console.error("[button-locations] POST error:", err);
      res.status(500).json({ error: "Failed to create button location" });
    }
  });

  app.delete("/api/button-locations/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = parseInt(_p(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.select({ id: schema.buttonLocations.id, userId: schema.buttonLocations.userId })
        .from(schema.buttonLocations).where(eq(schema.buttonLocations.id, id)).limit(1);
      if (!rows.length || rows[0].userId !== userId) return res.status(404).json({ error: "Not found" });
      await db.delete(schema.buttonLocations).where(eq(schema.buttonLocations.id, id));
      res.json({ deleted: true });
    } catch (err) {
      console.error("[button-locations] DELETE error:", err);
      res.status(500).json({ error: "Failed to delete button location" });
    }
  });

  app.patch("/api/button-locations/:id/confirm", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = parseInt(_p(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.select().from(schema.buttonLocations).where(and(eq(schema.buttonLocations.id, id), eq(schema.buttonLocations.userId, userId))).limit(1);
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const current = rows[0];
      const newConfidence = Math.min(1.0, current.confidence + 0.15);
      const [updated] = await db.update(schema.buttonLocations).set({
        confidence: newConfidence,
        stale: false,
        failCount: 0,
        lastConfirmedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(schema.buttonLocations.id, id)).returning();
      res.json({ entry: updated });
    } catch (err) {
      console.error("[button-locations] PATCH confirm error:", err);
      res.status(500).json({ error: "Failed to confirm button location" });
    }
  });

  app.patch("/api/button-locations/:id/deny", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const id = parseInt(_p(req.params.id), 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const rows = await db.select().from(schema.buttonLocations).where(and(eq(schema.buttonLocations.id, id), eq(schema.buttonLocations.userId, userId))).limit(1);
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      const current = rows[0];
      const newConfidence = Math.max(0, current.confidence - 0.2);
      const newFailCount = (current.failCount ?? 0) + 1;
      const nowStale = newConfidence < 0.3 || newFailCount >= 3;
      const [updated] = await db.update(schema.buttonLocations).set({
        confidence: newConfidence,
        stale: nowStale,
        failCount: newFailCount,
        updatedAt: new Date(),
      }).where(eq(schema.buttonLocations.id, id)).returning();
      res.json({ entry: updated });
    } catch (err) {
      console.error("[button-locations] PATCH deny error:", err);
      res.status(500).json({ error: "Failed to deny button location" });
    }
  });

  // ── GitHub Settings ─────────────────────────────────────────────────────────
  app.get("/api/github/settings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { getGitHubSettings, getGitHubUser, saveGitHubSettings } = await import("./integrations/github");
      const settings = await getGitHubSettings(userId);
      let username = settings.username ?? null;
      if (settings.pat && !username) {
        username = await getGitHubUser(settings.pat);
        if (username) {
          await saveGitHubSettings(userId, { username });
        }
      }
      res.json({ connected: !!settings.pat, repos: settings.repos, tokenType: settings.tokenType ?? null, username });
    } catch (err) {
      console.error("[GitHub] GET settings error:", err);
      res.status(500).json({ error: "Failed to load GitHub settings" });
    }
  });

  app.patch("/api/github/settings", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { pat, repos } = req.body as { pat?: string; repos?: string[] };
      const { saveGitHubSettings, getGitHubUser } = await import("./integrations/github");
      const patch: Parameters<typeof saveGitHubSettings>[1] = {
        ...(pat !== undefined ? { pat: pat || null } : {}),
        ...(repos !== undefined ? { repos } : {}),
      };
      if (pat) {
        const username = await getGitHubUser(pat);
        patch.username = username;
      } else if (pat !== undefined && !pat) {
        patch.username = null;
      }
      await saveGitHubSettings(userId, patch);
      res.json({ ok: true });
    } catch (err) {
      console.error("[GitHub] PATCH settings error:", err);
      res.status(500).json({ error: "Failed to save GitHub settings" });
    }
  });

  app.delete("/api/github/pat", authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).userId as string;
      const { saveGitHubSettings } = await import("./integrations/github");
      await saveGitHubSettings(userId, { pat: null, username: null });
      res.json({ ok: true });
    } catch (err) {
      console.error("[GitHub] DELETE pat error:", err);
      res.status(500).json({ error: "Failed to remove GitHub PAT" });
    }
  });

  // ── GitHub OAuth (Device Flow) ────────────────────────────────────────────────
  app.get("/api/github/oauth-available", async (_req: Request, res: Response) => {
    res.json({ available: !!process.env.GITHUB_CLIENT_ID });
  });

  app.post("/api/github/device/start", authMiddleware, async (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ error: "GitHub OAuth not configured on this server" });
    }
    try {
      const response = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, scope: "repo read:user" }).toString(),
      });
      if (!response.ok) {
        return res.status(502).json({ error: "GitHub API returned an error" });
      }
      const data = (await response.json()) as {
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
      };
      res.json(data);
    } catch (err) {
      console.error("[GitHub Device Flow] start error:", err);
      res.status(500).json({ error: "Failed to initiate device flow" });
    }
  });

  app.post("/api/github/device/poll", authMiddleware, async (req: Request, res: Response) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ error: "GitHub OAuth not configured on this server" });
    }
    const userId = (req as any).userId as string;
    const { device_code } = req.body as { device_code?: string };
    if (!device_code) {
      return res.status(400).json({ error: "device_code is required" });
    }
    try {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }).toString(),
      });
      const data = (await response.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };
      if (data.access_token) {
        const { saveGitHubSettings, getGitHubUser } = await import("./integrations/github");
        const username = await getGitHubUser(data.access_token);
        await saveGitHubSettings(userId, { pat: data.access_token, tokenType: "oauth", username });
        return res.json({ status: "authorized" });
      }
      if (data.error === "authorization_pending" || data.error === "slow_down") {
        return res.json({ status: "pending", error: data.error });
      }
      return res.json({ status: "error", error: data.error, message: data.error_description });
    } catch (err) {
      console.error("[GitHub Device Flow] poll error:", err);
      res.status(500).json({ error: "Failed to poll device flow" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
