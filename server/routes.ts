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
} from "./integrations/googleCalendar";
import {
  getOutlookCalendarEvents,
  checkOutlookConnection,
} from "./integrations/outlook";
import {
  checkGmailConnection,
  getRecentEmailCommitments,
  createGmailDraft,
} from "./integrations/gmail";
import { getSlackMessages } from "./integrations/slack";
import { authRouter, authMiddleware } from "./auth";
import { mobileAuthRouter } from "./mobileAuthRoutes";
import { registerDataRoutes } from "./dataRoutes";
import { registerTelegramRoutes } from "./telegramRoutes";
import { isIntegrationOwner, claimIntegrationOwnership } from "./integrationOwner";
import { oauthRouter, oauthCallbackRouter } from "./oauthRoutes";
import { getValidGoogleTokens, getValidMicrosoftToken, getUserTokens, getUserToken } from "./userTokenStore";
import { tavilySearch, formatSearchResults } from "./integrations/search";
import { logInteraction, getRecentInteractions, formatInteractionTimeline } from "./interactionLog";
import { extractAndStore } from "./memory/extractor";
import { getSoul, getSoulPromptBlock, regenerateSoul, setManualOverride } from "./memory/soul";
import { listPeople, deletePerson } from "./memory/people";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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

function buildCoachSystemPrompt(goals: any[], stats: any, history: any[], calendarEvents: any[] = [], lifeContext?: any, gmailItems?: any[], gmailConnected?: boolean, slackMessages?: any[], slackConnected?: boolean, commitmentsList?: any[], coachingMode?: string, memories?: { content: string; category: string }[], telegramMessages?: any[], telegramConnected?: boolean, morningNoteSummary?: string, documentsContext?: string, crossChannelContext?: string, soulBlock?: string): string {
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
Then add a brief note like "I've formatted this as a draft — tap 'Save to Drafts' to send it to your Gmail."`;
}

export async function buildPlanFromInputs(body: any): Promise<{
  reasoning: string;
  tasks: Array<{ title: string; category: string; priority: string; duration?: number; time?: string; description?: string }>;
}> {
  const { goals, calendarEvents, gmailItems, brainDump, completionHistory, energyLevel, coachingMode, existingTasks } = body;

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

  const prompt = `You are Jarvis, an autonomous planning AI. Build a realistic, prioritized daily plan for this person.

Today is ${dayOfWeek}, ${dateStr}.

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
  app.use(authMiddleware);
  app.use("/api/oauth", oauthRouter);

  registerDataRoutes(app);
  registerTelegramRoutes(app);

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
  ];

  function fuzzyMatch(needle: string, haystack: string): boolean {
    const n = needle.toLowerCase().trim();
    const h = haystack.toLowerCase().trim();
    return h.includes(n) || n.includes(h);
  }

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
      const systemPrompt = buildCoachSystemPrompt(goals || [], stats || {}, history || [], calendarEvents || [], lifeContext || null, resolvedGmailItems, resolvedGmailConnected, slackMessages || [], slackConnected ?? false, userCommitments, coachingMode, memories, telegramMessages || [], telegramConnected ?? false, morningNoteSummary, documentsContext, crossChannelContext, soulBlock);

      const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt + proactiveQuestionContext + "\n\nYou can take actions on the user's behalf using the available tools. When a user asks you to add a task, log progress, update their context, etc., use the appropriate tool. Respond naturally — do not mention 'tool calls' or 'functions' to the user. Just confirm what you did conversationally." + (process.env.TAVILY_API_KEY ? "\n\nYou also have a web_search tool. Use it whenever the user asks about current events, live data (weather, stock prices, sports scores, news), or anything requiring real-time information you wouldn't know. Cite your sources naturally in your response." : "") },
        ...messages.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];

      const actionResults: { tool: string; result: 'success' | 'error'; label: string }[] = [];
      let toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      if (userId) {
        const phase1 = await openai.chat.completions.create({
          model: "gpt-5-mini",
          messages: chatMessages,
          tools: coachTools,
          max_completion_tokens: 2048,
        });

        const choice = phase1.choices[0];
        if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
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
            const execResult = await executeCoachTool(tc.function.name, args, userId);
            actionResults.push({ tool: tc.function.name, result: execResult.result, label: execResult.label });
            toolMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ result: execResult.result, detail: execResult.detail }),
            });
          }
        } else if (choice.message.content) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('X-Accel-Buffering', 'no');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.flushHeaders();

          const words = choice.message.content;
          res.write(`data: ${JSON.stringify({ content: words })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          if (userId) {
            extractProfileInBackground(userId, messages);
            markProactiveQuestionsAnswered(userId, messages).catch(() => {});
            const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
            if (lastUserMsg?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)).catch(() => {});
            logInteraction(userId, "app_chat", "outbound", words).catch(() => {});
          }
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

      const streamMessages = toolMessages.length > 0
        ? [...chatMessages, ...toolMessages]
        : chatMessages;

      const stream = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: streamMessages,
        stream: true,
        max_completion_tokens: 8192,
      });

      let fullStreamedReply = '';
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullStreamedReply += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
      if (userId) {
        extractProfileInBackground(userId, messages);
        markProactiveQuestionsAnswered(userId, messages).catch(() => {});
        const lastUserMsg = [...messages].reverse().find((m: any) => m.role === 'user');
        if (lastUserMsg?.content) logInteraction(userId, "app_chat", "inbound", typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)).catch(() => {});
        if (fullStreamedReply) logInteraction(userId, "app_chat", "outbound", fullStreamedReply).catch(() => {});
      }
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
        .where(and(eq(schema.inboxItems.userId, userId), eq(schema.inboxItems.status, "pending")));
      res.json(items);
    } catch (error) {
      console.error("Error fetching inbox items:", error);
      res.status(500).json({ error: "Failed to fetch inbox items" });
    }
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
